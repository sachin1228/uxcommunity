-- ============================================================
-- C-1 — communities.member_count is a materialized counter
--
-- Migration under test: 20260927120000_community_member_count.sql
--
-- C-1 was that the sidebar and Explore read models counted rows in
-- community_members per request — 30 communities × 100k members is millions of
-- membership rows examined to render one sidebar, growing with every join. The
-- fix reads a counter kept on the community row instead.
--
-- A counter is only worth having if it cannot drift, so these assertions pin
-- every way membership can change:
--
--   * the column and both triggers exist;
--   * no second counter stack rides alongside them (a duplicate pair applied
--     by hand outside this repo double-counted every join and leave in the
--     live project — iasiso showed 4 for 2 members);
--   * a join, a multi-row join, a leave, a kick, the ON DELETE CASCADE from a
--     deleted user and a membership moved between two communities each move it
--     by exactly one;
--   * role / mute / last_read_at / archived_at updates, a duplicate join and a
--     membership rolled back with its transaction do not move it;
--   * the sidebar and Explore read models return the counter, and Explore still
--     excludes empty communities and still resolves the caller's own joined
--     flag per community;
--   * the backfill reconciles a counter a second trigger stack has inflated
--     (or deflated), without touching the communities that already agree;
--   * the backfill reconciles memberships written before the counter existed,
--     and every community in the database agrees with its membership rows.
--
-- The read-cost comparison (membership rows examined, old shape vs new) lives
-- in member_count_scale.test.sql, which needs committed fixtures and its own
-- psql sessions.
--
-- Fixtures are inserted inside a transaction and rolled back.
-- ============================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(40);

-- ─── Helpers ────────────────────────────────────────────────

-- Run a statement and report whether it survived. Used for the paths that must
-- not raise (a community delete cascading into the counter trigger) without
-- aborting this file on the way.
create or replace function pg_temp.attempt(q text) returns text
language plpgsql as $$
begin
  execute q;
  return 'ok';
exception when others then
  return 'raised ' || sqlstate || ': ' || sqlerrm;
end $$;

-- ─── Fixture ────────────────────────────────────────────────
-- Two communities and seven users, all rolled back at the end. The counter is
-- read through the `mc` view so every assertion names the same two numbers.

create temporary table mc_fixture as
select gen_random_uuid() as community_id,
       gen_random_uuid() as interest_id,
       gen_random_uuid() as other_community_id,
       gen_random_uuid() as other_interest_id,
       gen_random_uuid() as empty_community_id,
       gen_random_uuid() as empty_interest_id;

create temporary table mc_users as
select gen_random_uuid() as user_id, series.value as position
from generate_series(1, 7) as series(value);

insert into public.users (id, name, email, password_hash)
select user_id, 'C-1 counter fixture ' || position,
       format('%s@member-count.test', user_id), 'x'
from mc_users;

-- Explore resolves an interest community through its master-data row and drops
-- the community when the reference is missing, so each fixture community gets
-- its own temporary design_interests row (rolled back with everything else).
insert into public.design_interests (id, name)
select f.interest_id, format('C-1 fixture interest %s', f.interest_id) from mc_fixture f;

insert into public.design_interests (id, name)
select f.other_interest_id, format('C-1 fixture interest %s', f.other_interest_id) from mc_fixture f;

insert into public.design_interests (id, name)
select f.empty_interest_id, format('C-1 fixture interest %s', f.empty_interest_id) from mc_fixture f;

insert into public.communities (id, name, type, reference_id, is_active)
select f.community_id, 'C-1 counter fixture', 'interest', f.interest_id, true from mc_fixture f;

insert into public.communities (id, name, type, reference_id, is_active)
select f.other_community_id, 'C-1 counter fixture (destination)', 'interest', f.other_interest_id, true from mc_fixture f;

-- Nobody ever joins this one: it is what proves Explore's exclusion is the
-- counter's job (the old INNER JOIN to a membership aggregate used to be).
insert into public.communities (id, name, type, reference_id, is_active)
select f.empty_community_id, 'C-1 counter fixture (empty)', 'interest', f.empty_interest_id, true from mc_fixture f;

create temporary view mc as
select
  (select member_count from public.communities where id = f.community_id) as main_count,
  (select member_count from public.communities where id = f.other_community_id) as other_count
from mc_fixture f;

-- ─── 1. The counter and the triggers that maintain it ───────

select ok(
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'communities'
      and column_name = 'member_count'
      and data_type = 'integer'
      and is_nullable = 'NO'
  ),
  'communities.member_count exists as a not-null integer'
);

select has_function('public', 'sync_community_member_count');

-- The live project once carried a hand-applied second stack here
-- (community_members_increment_count / community_members_decrement_count →
-- update_community_member_count), so every join counted +2 and every leave
-- −2 and the header said "4 members" over a 2-person Members tab. These pin
-- exactly one non-internal counter stack on the table.

select is(
  (
    select count(*)::integer
    from pg_trigger t
    where t.tgrelid = 'public.community_members'::regclass
      and not t.tgisinternal
      and pg_get_triggerdef(t.oid) ilike '%member_count%'
  ),
  2,
  'exactly two member-count triggers exist on community_members'
);

select is(
  (
    select count(distinct tgf.proname)::integer
    from pg_trigger t
    join pg_proc tgf on tgf.oid = t.tgfoid
    where t.tgrelid = 'public.community_members'::regclass
      and not t.tgisinternal
      and pg_get_triggerdef(t.oid) ilike '%member_count%'
  ),
  1,
  'all member-count triggers call the one maintained function'
);

select ok(
  not exists (
    select 1 from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'update_community_member_count'
  ),
  'the rogue update_community_member_count function from the live project is gone'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'trg_community_members_count' and not tgisinternal
  ),
  'the INSERT/DELETE counter trigger is installed on community_members'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgname = 'trg_community_members_count_move' and not tgisinternal
  ),
  'the community_id-change counter trigger is installed on community_members'
);

-- ─── 2. A community starts empty ────────────────────────────

select is((select main_count from mc), 0, 'a new community starts at member_count 0');

-- ─── 3. Joins ───────────────────────────────────────────────

insert into public.community_members (community_id, user_id)
select f.community_id, u.user_id
from mc_fixture f, mc_users u
where u.position = 1;

select is((select main_count from mc), 1, 'the first member to join increments the counter');

insert into public.community_members (community_id, user_id)
select f.community_id, u.user_id
from mc_fixture f, mc_users u
where u.position between 2 and 5;

select is(
  (select main_count from mc),
  5,
  'a multi-row join increments once per membership row, not once per statement'
);

-- The shape every route uses for an idempotent join
-- (`onConflict: "community_id,user_id", ignoreDuplicates: true`).
insert into public.community_members (community_id, user_id)
select f.community_id, u.user_id
from mc_fixture f, mc_users u
where u.position = 1
on conflict (community_id, user_id) do nothing;

select is((select main_count from mc), 5, 'a duplicate join is ignored and does not increment twice');

-- The invite route's plain insert leaves idempotency to the primary key: a
-- repeat must fail loudly rather than count a second time.
select throws_ok(
  format(
    'insert into public.community_members (community_id, user_id) select %L::uuid, %L::uuid',
    (select community_id from mc_fixture),
    (select user_id from mc_users where position = 1)
  ),
  '23505',
  'duplicate key value violates unique constraint "community_members_pkey"',
  'a non-idempotent duplicate join fails on the primary key'
);

select is((select main_count from mc), 5, 'the rejected duplicate join leaves the counter untouched');

-- ─── 4. Updates that do not change membership ───────────────

update public.community_members
set role = 'admin', notifications_muted = true, last_read_at = now(), archived_at = now()
where community_id = (select community_id from mc_fixture)
  and user_id = (select user_id from mc_users where position = 4);

select is(
  (select main_count from mc),
  5,
  'role, mute, read and archive updates leave the counter alone'
);

-- ─── 5. Leaving and removal ─────────────────────────────────

delete from public.community_members
where community_id = (select community_id from mc_fixture)
  and user_id = (select user_id from mc_users where position = 5);

select is((select main_count from mc), 4, 'leaving decrements the counter');

delete from public.community_members
where community_id = (select community_id from mc_fixture)
  and user_id = (select user_id from mc_users where position = 3);

select is((select main_count from mc), 3, 'a kick (a manager removes a member) decrements the counter');

-- ─── 6. The cascade from a deleted user ─────────────────────
-- No application code runs on this path: the FK cascade deletes the rows, and
-- only a trigger can keep the counter with them.

delete from public.users where id = (select user_id from mc_users where position = 2);

select is((select main_count from mc), 2, 'deleting a user decrements the communities they were in');

-- ─── 7. A membership moved between communities ──────────────
-- No route writes community_id, but a future one must not be able to leave two
-- counters wrong by moving a row.

update public.community_members
set community_id = (select other_community_id from mc_fixture)
where community_id = (select community_id from mc_fixture)
  and user_id = (select user_id from mc_users where position = 1);

select is((select main_count from mc), 1, 'moving a membership out decrements the source counter');
select is((select other_count from mc), 1, 'moving a membership in increments the destination counter');

-- ─── 8. A membership rolled back with its transaction ───────

savepoint mc_failed_membership;

insert into public.community_members (community_id, user_id)
select f.community_id, u.user_id
from mc_fixture f, mc_users u
where u.position = 6;

select is((select main_count from mc), 2, 'a membership is counted as soon as it lands in the transaction');

rollback to savepoint mc_failed_membership;

select is((select main_count from mc), 1, 'rolling the membership back rolls the counter back with it');

-- ─── 9. Every community agrees with its members ─────────────
-- Presupposes the seeded fixtures: their memberships were inserted after the
-- migration, so a counter that only worked for communities created by the same
-- statement would show up here.

select is(
  (
    select count(*)::integer
    from public.communities c
    where c.member_count <> (
      select count(*)::integer
      from public.community_members cm
      where cm.community_id = c.id
    )
  ),
  0,
  'every community in the database agrees with its membership rows'
);

-- ─── 10. Backfilling memberships that predate the counter ───

savepoint mc_backfill;

alter table public.community_members disable trigger user;

insert into public.community_members (community_id, user_id)
select f.community_id, u.user_id
from mc_fixture f, mc_users u
where u.position in (1, 6, 7);

alter table public.community_members enable trigger user;

select is(
  (select main_count from mc),
  1,
  'memberships written with the counter triggers disabled are not counted (the pre-migration state)'
);

select is(
  (
    select count(*)::integer
    from public.community_members
    where community_id = (select community_id from mc_fixture)
  ),
  4,
  'the legacy rows really are in the membership table'
);

-- Step 2 of 20260927120000_community_member_count.sql, verbatim.
update public.communities as c
set member_count = coalesce(counted.total, 0)
from (
  select community.id,
         count(member.user_id)::integer as total
  from public.communities as community
  left join public.community_members as member
    on member.community_id = community.id
  group by community.id
) as counted
where counted.id = c.id
  and c.member_count is distinct from coalesce(counted.total, 0);

select is((select main_count from mc), 4, 'the backfill reconciles memberships that predate the counter');

-- ─── 10b. Reconciling a counter a second stack inflated ──────
-- The drift the live project actually hit: a hand-applied second trigger pair
-- moved the counter alongside the maintained one, so joins counted twice.
-- With the duplicate triggers gone (section 1), no trigger fires here — the
-- backfill alone must return the inflated counter to the real row count. The
-- fixture community carries 4 membership rows at this point (its maintained
-- member plus the three legacy rows from section 10).

savepoint mc_double_counted;

update public.communities
set member_count = member_count * 2
where id = (select community_id from mc_fixture);

select is((select main_count from mc), 8, 'the fixture is now double-counted, as iasiso was');

-- Step 2 of 20260927120000_community_member_count.sql, verbatim.
update public.communities as c
set member_count = coalesce(counted.total, 0)
from (
  select community.id,
         count(member.user_id)::integer as total
  from public.communities as community
  left join public.community_members as member
    on member.community_id = community.id
  group by community.id
) as counted
where counted.id = c.id
  and c.member_count is distinct from coalesce(counted.total, 0);

select is((select main_count from mc), 4, 'the backfill reconciles a double-counted community');

rollback to savepoint mc_double_counted;

select is((select main_count from mc), 4, 'rolling the inflation back restores the correct counter');

-- ─── 11. The read models ────────────────────────────────────
-- The viewer below is position 6: a member of the main community (its
-- membership is one of the legacy rows) and of nothing else.

select is(
  (
    select (entry ->> 'member_count')::integer
    from jsonb_array_elements(
      public.get_sidebar_activity((select user_id from mc_users where position = 6))
    ) as entry
    where entry ->> 'community_id' = (select community_id::text from mc_fixture)
  ),
  4,
  'the sidebar returns the community counter instead of counting its members'
);

select is(
  (
    select count(*)::integer
    from jsonb_array_elements(
      public.get_sidebar_activity((select user_id from mc_users where position = 6))
    ) as entry
    where (entry ->> 'member_count')::integer <> (
      select c.member_count from public.communities c where c.id = (entry ->> 'community_id')::uuid
    )
  ),
  0,
  'every sidebar row reports its community counter (what the mobile list reconcile reads)'
);

select is(
  (
    select community.member_count::integer
    from public.get_all_communities((select user_id from mc_users where position = 6)) as community
    where community.id = (select community_id from mc_fixture)
  ),
  4,
  'Explore returns the materialized count'
);

select is(
  (
    select count(*)::integer
    from public.get_all_communities((select user_id from mc_users where position = 6)) as community
    where community.member_count <> (
      select c.member_count from public.communities c where c.id = community.id
    )
  ),
  0,
  'every Explore row reports its community counter'
);

select is(
  (
    select community.joined
    from public.get_all_communities((select user_id from mc_users where position = 6)) as community
    where community.id = (select community_id from mc_fixture)
  ),
  true,
  'Explore still resolves joined = true for a community the caller is in'
);

select is(
  (
    select community.joined
    from public.get_all_communities((select user_id from mc_users where position = 6)) as community
    where community.id = (select other_community_id from mc_fixture)
  ),
  false,
  'Explore still resolves joined = false for a community the caller is not in'
);

select is(
  (
    select count(*)::integer
    from public.get_all_communities((select user_id from mc_users where position = 6)) as community
    where community.member_count <= 0
  ),
  0,
  'Explore still excludes communities with no members'
);

-- The fixture's master-data reference resolves, so member_count = 0 is the only
-- reason it can be missing from the list: exactly what the old INNER JOIN did.
select is(
  (
    select count(*)::integer
    from public.get_all_communities((select user_id from mc_users where position = 6)) as community
    where community.id = (select empty_community_id from mc_fixture)
  ),
  0,
  'Explore drops an empty community whose master-data reference resolves'
);

select is(
  (
    select (entry ->> 'member_count')::integer
    from jsonb_array_elements(
      public.get_sidebar_activity('11111111-1111-1111-1111-111111111111'::uuid)
    ) as entry
    where entry ->> 'community_id' = 'aaaaaaaa-0000-0000-0000-00000000000a'
  ),
  2,
  'a community seeded before this test file reports its seeded members'
);

-- ─── 12. Deleting a community with members ──────────────────
-- The cascade deletes the membership rows, and the counter trigger then has no
-- community row left to update. It must be a no-op, not an error.

select is(
  pg_temp.attempt(
    format(
      'delete from public.communities where id = %L::uuid',
      (select other_community_id from mc_fixture)
    )
  ),
  'ok',
  'deleting a community with members does not trip the counter trigger'
);

-- ─── 13. The indexes membership operations still need ───────
-- The counter added none: it lives on the community row, and the counting
-- follow-up (a per-community count) was already served by the primary key.

select has_index('public', 'community_members', 'community_members_pkey',
  'the (community_id, user_id) primary key still serves per-community membership reads');

select has_index('public', 'community_members', 'idx_community_members_user',
  'the per-user membership index is still needed (sidebar, push recipients, admin)');

select has_index('public', 'communities', 'idx_communities_active_name',
  'the active-community name index still serves the Explore ordering');

select * from finish();
rollback;
