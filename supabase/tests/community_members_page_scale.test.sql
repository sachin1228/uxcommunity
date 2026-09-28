-- ============================================================
-- M-2 — what one member page costs, before and after
--
-- Migration under test: 20260928120000_community_members_page.sql
--
-- Read cost cannot be shown from inside a rolled-back transaction, so this
-- file is separate from community_members_page.test.sql and commits its
-- fixture (the same reason member_count_scale.test.sql exists for C-1). The
-- statistics collector only publishes a backend's deltas at transaction end,
-- so "membership rows examined" is measured from pg_stat_all_tables /
-- pg_stat_all_indexes with the counters read around one read.
--
-- The comparison is the whole point of M-2:
--
--   BEFORE  fetch the community's members ordered by joined_at, slice in the
--           application            → every membership row examined
--   AFTER   one bounded 30-row page selected by the database
--                                  → roughly a page examined
--
-- A plan-independent measurement is used because EXPLAIN cannot see inside
-- these functions (a plpgsql body is a Function Scan).
--
-- The fixture is committed, so the file clears its own leftovers first and
-- cleans up after itself: the files after it share the same scratch database.
-- ============================================================

create extension if not exists pgtap with schema extensions;
select plan(7);

-- ─── Fixture ────────────────────────────────────────────────
-- One community with 400 members. Fixed community id so the cleanup can name
-- it in SQL text.

delete from public.communities where id = '2a2a2a2a-0000-4000-8000-000000000001';
delete from public.users where email like '%@member-page-scale.test';

insert into public.communities (id, name, type, is_active)
values ('2a2a2a2a-0000-4000-8000-000000000001', 'M-2 scale fixture', 'interest', true);

insert into public.users (id, name, email, password_hash)
values ('2a2a2a2a-0000-4000-8000-000000000011', 'M-2 scale owner',
        'owner@member-page-scale.test', 'x');

insert into public.users (id, name, email, password_hash)
select bulk.user_id, 'M-2 scale member',
       format('bulk-%s@member-page-scale.test', bulk.user_id), 'x'
from (select gen_random_uuid() as user_id from generate_series(1, 399)) as bulk;

insert into public.community_members (community_id, user_id, role)
values ('2a2a2a2a-0000-4000-8000-000000000001',
        '2a2a2a2a-0000-4000-8000-000000000011', 'owner');

insert into public.community_members (community_id, user_id)
select '2a2a2a2a-0000-4000-8000-000000000001', u.id
from public.users u
where u.email like 'bulk-%@member-page-scale.test';

-- Fresh statistics so the planner can choose the page index rather than a
-- sequential scan over a table it still believes is nearly empty.
analyze public.community_members;
analyze public.users;

select is(
  (select count(*)::integer from public.community_members
   where community_id = '2a2a2a2a-0000-4000-8000-000000000001'),
  400,
  'the fixture community has 400 memberships'
);

select is(
  (select member_count from public.communities
   where id = '2a2a2a2a-0000-4000-8000-000000000001'),
  400,
  'the C-1 counter agrees with the fixture'
);

-- ─── Read cost: membership rows examined per page ───────────
-- pg_stat_all_tables / pg_stat_all_indexes: heap rows read by sequential
-- scans, heap rows fetched through an index, and index entries read (a count
-- served by an index-only scan shows up in the last one only).

create or replace function pg_temp.member_rows_examined() returns bigint
language sql as $$
  select
    coalesce((select seq_tup_read from pg_stat_all_tables
              where schemaname = 'public' and relname = 'community_members'), 0)
  + coalesce((select idx_tup_fetch from pg_stat_all_tables
              where schemaname = 'public' and relname = 'community_members'), 0)
  + coalesce((select sum(idx_tup_read) from pg_stat_all_indexes
              where schemaname = 'public' and relname = 'community_members'), 0);
$$;

create temporary table m2s_cost (position serial primary key, measurement text, cumulative bigint);

select pg_sleep(1.5);
insert into m2s_cost (measurement, cumulative)
values ('baseline', pg_temp.member_rows_examined());

-- BEFORE: every membership row of the community, ordered by joined_at. This is
-- the row set the old route transferred and then sliced in JavaScript.
select count(*)::integer
from (
  select user_id, joined_at, role
  from public.community_members
  where community_id = '2a2a2a2a-0000-4000-8000-000000000001'
  order by joined_at asc
) every_member;
select pg_sleep(1.5);
insert into m2s_cost (measurement, cumulative)
values ('old_page', pg_temp.member_rows_examined());

-- AFTER: one 30-row page, selected by the database.
select count(*)::integer
from public.get_community_members_page(
  '2a2a2a2a-0000-4000-8000-000000000001', null, 30, 0);
select pg_sleep(1.5);
insert into m2s_cost (measurement, cumulative)
values ('new_page', pg_temp.member_rows_examined());

create temporary view m2s_measured as
select
  max(examined) filter (where measurement = 'old_page') as old_page,
  max(examined) filter (where measurement = 'new_page') as new_page
from (
  select measurement, cumulative - lag(cumulative) over (order by position) as examined
  from m2s_cost
) deltas;

select ok(
  (select old_page from m2s_measured) >= 400,
  format('control: the old shape examined every membership of the 400-member community (%s rows)',
         (select old_page from m2s_measured))
);

select ok(
  (select new_page from m2s_measured) > 0,
  format('control: the measurement sees the new page read touch the membership table (%s rows)',
         (select new_page from m2s_measured))
);

select ok(
  (select new_page from m2s_measured) <= 76,
  format('one 30-row page examines roughly a page of memberships, not the community (%s rows for a 400-member community)',
         (select new_page from m2s_measured))
);

select ok(
  (select new_page from m2s_measured) * 5 < (select old_page from m2s_measured),
  format('the page read no longer scales with community size (%s rows and falling, was %s)',
         (select new_page from m2s_measured), (select old_page from m2s_measured))
);

-- ─── Cleanup ────────────────────────────────────────────────

delete from public.communities where id = '2a2a2a2a-0000-4000-8000-000000000001';
delete from public.users where email like '%@member-page-scale.test';

select is(
  (select count(*)::integer from public.users where email like '%@member-page-scale.test'),
  0,
  'cleanup removed the scale fixture'
);

select * from finish();
