-- ============================================================
-- M-2 — Community member list is paginated in the database
--
-- Migration under test: 20260928120000_community_members_page.sql
--
-- M-2 was that GET /api/communities/[id]/members transferred every membership
-- row of a community and sliced the requested page in Node: asking for 30
-- members of a 50,000-member community transferred 50,000 rows to return 30.
-- public.get_community_members_page now applies the LIMIT/OFFSET itself.
--
-- These assertions pin the properties that matter:
--
--   * ordering is identical to the old (role rank, joined_at) order, with a
--     deterministic user_id tie-break;
--   * a page returns exactly the requested rows, consecutive pages are
--     disjoint and cover every member once, a page past the end is empty;
--   * limit/offset are clamped (oversized, non-positive, negative);
--   * total is the community count (from the C-1 counter) or the match count;
--   * the function is service-role only.
--
-- The read-cost comparison (membership rows examined, old shape vs new) lives
-- in community_members_page_scale.test.sql, which needs committed fixtures —
-- the statistics collector only publishes a backend's deltas at transaction
-- end, so a rolled-back transaction cannot measure them.
--
-- Fixtures are inserted inside a transaction and rolled back.
-- ============================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(23);

-- ─── Fixture ────────────────────────────────────────────────
-- One 75-member community (three pages: 30 + 30 + 15) with an owner, two
-- admins and 72 members, and a 400-member community for the cost comparison.
-- joined_at is `position / 2` minutes, so positions 30/31 and 60/61 tie —
-- exactly on the page boundaries — which is what makes the user_id tie-break
-- observable.

create temporary table m2_fixture as
select gen_random_uuid() as community_id,
       gen_random_uuid() as big_community_id,
       gen_random_uuid() as empty_community_id;

create temporary table m2_users as
select gen_random_uuid() as user_id, series.value as position
from generate_series(1, 75) as series(value);

insert into public.users (id, name, email, password_hash)
select user_id,
       'M-2 member fixture ' || lpad(position::text, 3, '0'),
       format('%s@member-page.test', user_id),
       'x'
from m2_users;

insert into public.communities (id, name, type, is_active)
select community_id, 'M-2 member fixture', 'interest', true from m2_fixture;
insert into public.communities (id, name, type, is_active)
select big_community_id, 'M-2 member fixture (large)', 'interest', true from m2_fixture;
insert into public.communities (id, name, type, is_active)
select empty_community_id, 'M-2 member fixture (empty)', 'interest', true from m2_fixture;

insert into public.community_members (community_id, user_id, role, joined_at)
select f.community_id,
       u.user_id,
       case when u.position = 1 then 'owner' when u.position <= 3 then 'admin' else 'member' end,
       timestamptz '2026-01-01 00:00:00+00' + interval '1 minute' * (u.position / 2)
from m2_fixture f, m2_users u;

-- The large community: 400 memberships from 400 fresh users.
create temporary table m2_big_users as
select gen_random_uuid() as user_id, series.value as position
from generate_series(1, 400) as series(value);

insert into public.users (id, name, email, password_hash)
select user_id, 'M-2 big fixture ' || position,
       format('%s@member-page.test', user_id), 'x'
from m2_big_users;

insert into public.community_members (community_id, user_id, role, joined_at)
select f.big_community_id, u.user_id, 'member',
       timestamptz '2026-01-01 00:00:00+00' + interval '1 minute' * u.position
from m2_fixture f, m2_big_users u;

-- The order the OLD route produced: fetch by joined_at, then stable-sort by
-- role rank. The database equivalent (and what the function must return) is
-- (role rank, joined_at, user_id).
create temporary view m2_expected as
select user_id,
       row_number() over (
         order by (case role when 'owner' then 0 when 'admin' then 1 else 2 end),
                  joined_at,
                  user_id
       ) as expected_position
from public.community_members
where community_id = (select community_id from m2_fixture);

-- ─── 1. The function, the index and the grants ──────────────

select has_function('public', 'get_community_members_page',
  array['uuid', 'text', 'integer', 'integer']);

select has_index('public', 'community_members', 'idx_community_members_page',
  'the index that lets a page come from the top of a scan instead of a full sort');

select ok(
  not has_function_privilege('anon',
    'public.get_community_members_page(uuid,text,integer,integer)', 'execute'),
  'anon cannot execute the member page function');

select ok(
  not has_function_privilege('authenticated',
    'public.get_community_members_page(uuid,text,integer,integer)', 'execute'),
  'authenticated cannot execute the member page function');

select ok(
  has_function_privilege('service_role',
    'public.get_community_members_page(uuid,text,integer,integer)', 'execute'),
  'service_role can execute the member page function');

-- ─── 2. A page returns exactly the requested rows, in order ─
-- The first page is the owner, the two admins, then members by join order.

select is(
  (select count(*)::integer
   from public.get_community_members_page(
     (select community_id from m2_fixture), null, 30, 0)),
  30,
  'page 0 returns exactly 30 members'
);

select is(
  (select array_agg(role order by ord)
   from public.get_community_members_page(
     (select community_id from m2_fixture), null, 3, 0) with ordinality
     as page(user_id, joined_at, role, name, total, ord)),
  array['owner', 'admin', 'admin'],
  'the page opens with the owner, then the admins, in role order'
);

select is(
  (select array_agg(user_id order by ord)
   from public.get_community_members_page(
     (select community_id from m2_fixture), null, 30, 0) with ordinality
     as page(user_id, joined_at, role, name, total, ord)),
  (select array_agg(user_id order by expected_position)
   from m2_expected where expected_position <= 30),
  'page 0 is the first 30 rows of the old (role, joined_at, user_id) order'
);

select is(
  (select array_agg(user_id order by ord)
   from public.get_community_members_page(
     (select community_id from m2_fixture), null, 30, 30) with ordinality
     as page(user_id, joined_at, role, name, total, ord)),
  (select array_agg(user_id order by expected_position)
   from m2_expected where expected_position between 31 and 60),
  'page 1 is the next 30 rows of the same order'
);

-- ─── 3. Pages do not overlap and leave nothing out ──────────
-- joined_at ties land exactly on the 30/31 and 60/61 boundaries; only a
-- deterministic tie-break keeps the pages from repeating or skipping a row.

select is(
  (select count(distinct user_id)::integer from (
     select user_id from public.get_community_members_page(
       (select community_id from m2_fixture), null, 30, 0)
     union all
     select user_id from public.get_community_members_page(
       (select community_id from m2_fixture), null, 30, 30)
     union all
     select user_id from public.get_community_members_page(
       (select community_id from m2_fixture), null, 30, 60)
   ) pages),
  75,
  'paging through the community returns each member exactly once'
);

select is(
  (select count(*)::integer
   from public.get_community_members_page(
     (select community_id from m2_fixture), null, 30, 60)),
  15,
  'the last page returns the remaining 15 members'
);

select is(
  (select count(*)::integer
   from public.get_community_members_page(
     (select community_id from m2_fixture), null, 30, 90)),
  0,
  'a page past the end is empty'
);

select is(
  (select count(*)::integer
   from public.get_community_members_page(
     (select community_id from m2_fixture), null, 30, 300)),
  0,
  'a far page beyond the end is empty'
);

-- ─── 4. total and has_more ──────────────────────────────────

select is(
  (select distinct total::integer
   from public.get_community_members_page(
     (select community_id from m2_fixture), null, 30, 0)),
  75,
  'total is the community member count'
);

select is(
  (select distinct total::integer
   from public.get_community_members_page(
     (select community_id from m2_fixture), null, 30, 60)),
  75,
  'total does not shrink on a later page'
);

-- ─── 5. Limits and offsets are clamped ──────────────────────

select is(
  (select count(*)::integer
   from public.get_community_members_page(
     (select big_community_id from m2_fixture), null, 1000, 0)),
  100,
  'an oversized limit is capped at 100 rows'
);

select is(
  (select count(*)::integer
   from public.get_community_members_page(
     (select big_community_id from m2_fixture), null, -5, 0)),
  1,
  'a non-positive limit still returns one bounded row, never everything'
);

select is(
  (select count(*)::integer
   from public.get_community_members_page(
     (select big_community_id from m2_fixture), null, 30, -10)),
  30,
  'a negative offset is clamped to the first page'
);

-- ─── 6. Search ──────────────────────────────────────────────
-- Names are 'M-2 member fixture 001' … '075'.

select is(
  (select count(*)::integer
   from public.get_community_members_page(
     (select community_id from m2_fixture), 'fixture 07', 30, 0)),
  6,
  'search returns only the matching members, in one bounded page'
);

select is(
  (select distinct total::integer
   from public.get_community_members_page(
     (select community_id from m2_fixture), 'fixture 07', 30, 0)),
  6,
  'a search reports the match count, not the community count'
);

select is(
  (select count(*)::integer
   from public.get_community_members_page(
     (select community_id from m2_fixture), 'no-such-member', 30, 0)),
  0,
  'a search with no matches returns an empty page'
);

-- ─── 7. An empty community ──────────────────────────────────

select is(
  (select count(*)::integer
   from public.get_community_members_page(
     (select empty_community_id from m2_fixture), null, 30, 0)),
  0,
  'an empty community returns an empty page'
);

-- ─── Cleanup ────────────────────────────────────────────────

delete from public.communities
where id in (select community_id from m2_fixture
             union all select big_community_id from m2_fixture
             union all select empty_community_id from m2_fixture);
delete from public.users where email like '%@member-page.test';

select is(
  (select count(*)::integer from public.users where email like '%@member-page.test'),
  0,
  'cleanup removed the fixture users'
);

select * from finish();
rollback;
