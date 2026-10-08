-- ============================================================
-- C-1 — the counter under concurrent membership writes, and what the read
-- models cost before and after it
--
-- Migration under test: 20260927120000_community_member_count.sql
--
-- Two things cannot be shown from inside a single rolled-back transaction, so
-- this file is separate from member_count.test.sql and commits its fixture:
--
--   1. CONCURRENCY. Two real sessions overlap inside a transaction that holds
--      the counter row lock the trigger takes, so a read-modify-write that
--      lost an update (100 + 1 and 100 + 1 landing as 101) would show up as a
--      wrong total. The sessions are started from psql \! and need the
--      PGHOST/PGDATABASE/PGUSER this harness exports, plus a server that is
--      reachable with a bare `psql` — see the LIMITS note in run-local.sh.
--
--   2. READ COST. "Membership rows examined per request" is measured from
--      pg_stat_all_tables / pg_stat_all_indexes with the counters reset around
--      one read, for the pre-C-1 query shape and for the shape that replaced
--      it. It is a plan-independent measure (EXPLAIN cannot see inside these
--      SQL functions: they declare `set search_path`, which stops inlining).
--
-- The fixture is committed, so the file also cleans up after itself — and
-- clears its own leftovers first, in case an earlier run failed before its
-- cleanup. It must leave the database exactly as it found it: the files after
-- it share the same scratch database.
-- ============================================================

create extension if not exists pgtap with schema extensions;
select plan(21);

-- ─── Fixture ────────────────────────────────────────────────
-- One community with 301 members (one of them the viewer), plus five users for
-- the concurrent rounds. Fixed ids: the child sessions and the cleanup name
-- them in SQL text.

delete from public.communities where id = 'c1c1c1c1-0000-4000-8000-000000000001';
delete from public.users where email like '%@member-count.test';
delete from public.cities where id = 'c1c1c1c1-0000-4000-8000-000000000002';

insert into public.cities (id, name)
values ('c1c1c1c1-0000-4000-8000-000000000002', 'C-1 scale fixture city');

insert into public.communities (id, name, type, reference_id, is_active)
values ('c1c1c1c1-0000-4000-8000-000000000001', 'C-1 scale fixture', 'city',
        'c1c1c1c1-0000-4000-8000-000000000002', true);

insert into public.users (id, name, email, password_hash)
values
  ('c1c1c1c1-0000-4000-8000-000000000011', 'C-1 viewer',   'viewer@member-count.test',   'x'),
  ('c1c1c1c1-0000-4000-8000-000000000012', 'C-1 joiner a', 'joiner-a@member-count.test', 'x'),
  ('c1c1c1c1-0000-4000-8000-000000000013', 'C-1 joiner b', 'joiner-b@member-count.test', 'x'),
  ('c1c1c1c1-0000-4000-8000-000000000014', 'C-1 joiner c', 'joiner-c@member-count.test', 'x'),
  ('c1c1c1c1-0000-4000-8000-000000000015', 'C-1 joiner d', 'joiner-d@member-count.test', 'x'),
  ('c1c1c1c1-0000-4000-8000-000000000016', 'C-1 joiner e', 'joiner-e@member-count.test', 'x');

insert into public.users (id, name, email, password_hash)
select bulk.user_id, 'C-1 bulk member',
       format('bulk-%s@member-count.test', bulk.user_id), 'x'
from (select gen_random_uuid() as user_id from generate_series(1, 300)) as bulk;

-- Every one of these rows goes through the counter trigger, in one statement.
insert into public.community_members (community_id, user_id)
select 'c1c1c1c1-0000-4000-8000-000000000001', u.id
from public.users u
where u.email like 'bulk-%@member-count.test'
   or u.id = 'c1c1c1c1-0000-4000-8000-000000000011';

select is(
  (
    select count(*)::integer
    from public.community_members
    where community_id = 'c1c1c1c1-0000-4000-8000-000000000001'
  ),
  301,
  'the fixture community has 301 memberships'
);

select is(
  (
    select member_count
    from public.communities
    where id = 'c1c1c1c1-0000-4000-8000-000000000001'
  ),
  301,
  'a 301-row join through the trigger leaves the counter exact'
);

-- ─── Two joins at once ──────────────────────────────────────
-- Both transactions insert first (the foreign key only takes FOR KEY SHARE) and
-- then take the counter row's lock, so the second one waits for the first and
-- reads the value it just wrote. Losing that update would leave 302.

\! bash -c "psql -q -o /dev/null -c \"begin; insert into public.community_members (community_id, user_id) values ('c1c1c1c1-0000-4000-8000-000000000001', 'c1c1c1c1-0000-4000-8000-000000000012'); select pg_sleep(0.6); commit;\" & psql -q -o /dev/null -c \"begin; insert into public.community_members (community_id, user_id) values ('c1c1c1c1-0000-4000-8000-000000000001', 'c1c1c1c1-0000-4000-8000-000000000013'); select pg_sleep(0.6); commit;\" & wait"

select is(
  (
    select count(*)::integer
    from public.community_members
    where community_id = 'c1c1c1c1-0000-4000-8000-000000000001'
      and user_id in ('c1c1c1c1-0000-4000-8000-000000000012', 'c1c1c1c1-0000-4000-8000-000000000013')
  ),
  2,
  'both concurrent join transactions committed'
);

select is(
  (
    select member_count
    from public.communities
    where id = 'c1c1c1c1-0000-4000-8000-000000000001'
  ),
  303,
  'two overlapping joins are two increments, not one increment applied twice'
);

-- ─── A leave and a join at once ─────────────────────────────
-- Same contention, opposite directions: the delete and the insert both try to
-- take the counter row inside their transaction.

\! bash -c "psql -q -o /dev/null -c \"begin; delete from public.community_members where community_id = 'c1c1c1c1-0000-4000-8000-000000000001' and user_id = 'c1c1c1c1-0000-4000-8000-000000000012'; select pg_sleep(0.6); commit;\" & psql -q -o /dev/null -c \"begin; insert into public.community_members (community_id, user_id) values ('c1c1c1c1-0000-4000-8000-000000000001', 'c1c1c1c1-0000-4000-8000-000000000014'); select pg_sleep(0.6); commit;\" & wait"

select is(
  (
    select count(*)::integer
    from public.community_members
    where community_id = 'c1c1c1c1-0000-4000-8000-000000000001'
      and user_id = 'c1c1c1c1-0000-4000-8000-000000000012'
  ),
  0,
  'the concurrent leave committed'
);

select is(
  (
    select count(*)::integer
    from public.community_members
    where community_id = 'c1c1c1c1-0000-4000-8000-000000000001'
      and user_id = 'c1c1c1c1-0000-4000-8000-000000000014'
  ),
  1,
  'the concurrent join in the leave/join round committed'
);

select is(
  (
    select member_count
    from public.communities
    where id = 'c1c1c1c1-0000-4000-8000-000000000001'
  ),
  303,
  'an overlapping leave and join net out to the same count'
);

-- ─── A join that rolls back while another joins ─────────────
-- This is the failure mode a counter maintained from the application would
-- show: the abandoned transaction's increment must not survive, and the join
-- waiting on the row lock must still land on the count that did.

\! bash -c "psql -q -o /dev/null -c \"begin; insert into public.community_members (community_id, user_id) values ('c1c1c1c1-0000-4000-8000-000000000001', 'c1c1c1c1-0000-4000-8000-000000000015'); select pg_sleep(0.6); rollback;\" & psql -q -o /dev/null -c \"begin; insert into public.community_members (community_id, user_id) values ('c1c1c1c1-0000-4000-8000-000000000001', 'c1c1c1c1-0000-4000-8000-000000000016'); select pg_sleep(0.6); commit;\" & wait"

select is(
  (
    select count(*)::integer
    from public.community_members
    where community_id = 'c1c1c1c1-0000-4000-8000-000000000001'
      and user_id = 'c1c1c1c1-0000-4000-8000-000000000015'
  ),
  0,
  'the rolled-back join left no membership row'
);

select is(
  (
    select count(*)::integer
    from public.community_members
    where community_id = 'c1c1c1c1-0000-4000-8000-000000000001'
      and user_id = 'c1c1c1c1-0000-4000-8000-000000000016'
  ),
  1,
  'the join that overlapped the rollback committed'
);

select is(
  (
    select member_count
    from public.communities
    where id = 'c1c1c1c1-0000-4000-8000-000000000001'
  ),
  304,
  'a rolled-back join is never counted, even while another join waits on the counter row'
);

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
  'no community drifted through the concurrent rounds'
);

-- ─── Read cost: membership rows examined per request ────────
-- How many membership rows Postgres actually touched, as counted by
-- pg_stat_all_tables / pg_stat_all_indexes: heap rows read by sequential
-- scans, heap rows fetched through an index, and index entries read (a
-- count served by an index-only scan shows up in the last one only).
--
-- The counters are cumulative and a PostgreSQL 14 stats collector publishes a
-- backend's deltas on the first transaction end at least a second after the
-- last flush, so each read is recorded after a settle and the cost of a read
-- is the difference from the value recorded before it. That ordering is what
-- keeps a window exact: by the time a workload runs, everything before it has
-- been flushed into the baseline, and by the time its result is read, its own
-- counters have been flushed too. Nothing else writes membership rows here —
-- the concurrent rounds are finished — so the difference is the read's.

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

create temporary table mc_cost (position serial primary key, measurement text, cumulative bigint);

select pg_sleep(1.5);
insert into mc_cost (measurement, cumulative)
values ('baseline', pg_temp.member_rows_examined());

-- BEFORE: the `member_counts` CTE get_sidebar_activity used to run — the
-- caller's communities' memberships, counted.
select count(*)::integer
from public.community_members cm
join (
  select community_id
  from public.community_members
  where user_id = 'c1c1c1c1-0000-4000-8000-000000000011'
) mine on mine.community_id = cm.community_id
group by cm.community_id;
select pg_sleep(1.5);
insert into mc_cost (measurement, cumulative)
values ('old_sidebar', pg_temp.member_rows_examined());

-- AFTER: the same sidebar read.
select count(*)::integer from public.get_sidebar_activity('c1c1c1c1-0000-4000-8000-000000000011');
select pg_sleep(1.5);
insert into mc_cost (measurement, cumulative)
values ('new_sidebar', pg_temp.member_rows_examined());

-- BEFORE: the `membership_aggregates` CTE get_all_communities used to run —
-- the whole membership table, grouped and counted.
select count(*)::integer
from (
  select cm.community_id, count(*) as member_count, bool_or(cm.user_id = 'c1c1c1c1-0000-4000-8000-000000000011') as joined
  from public.community_members cm
  group by cm.community_id
) aggregates;
select pg_sleep(1.5);
insert into mc_cost (measurement, cumulative)
values ('old_explore', pg_temp.member_rows_examined());

-- AFTER: the same Explore read.
select count(*)::integer from public.get_all_communities('c1c1c1c1-0000-4000-8000-000000000011');
select pg_sleep(1.5);
insert into mc_cost (measurement, cumulative)
values ('new_explore', pg_temp.member_rows_examined());

-- One read's cost is the difference between consecutive cumulative readings.
-- The measured numbers are in every description: a failure over a fixture of
-- this size should say what it saw, not just that it disagreed.
create temporary view mc_measured as
select
  max(examined) filter (where measurement = 'old_sidebar') as old_sidebar,
  max(examined) filter (where measurement = 'new_sidebar') as new_sidebar,
  max(examined) filter (where measurement = 'old_explore') as old_explore,
  max(examined) filter (where measurement = 'new_explore') as new_explore
from (
  select measurement,
         cumulative - lag(cumulative) over (order by position) as examined
  from mc_cost
) deltas;

select ok(
  (select old_sidebar from mc_measured) >= 300,
  format('control: the pre-C-1 sidebar count examined every membership of the caller''s community (%s rows)',
         (select old_sidebar from mc_measured))
);

select ok(
  (select new_sidebar from mc_measured) > 0,
  format('control: the measurement sees the new sidebar read touch the membership table (%s rows)',
         (select new_sidebar from mc_measured))
);

select ok(
  (select new_sidebar from mc_measured) <= 5,
  format('the sidebar read examines only the caller''s own memberships (%s rows for a 304-member community)',
         (select new_sidebar from mc_measured))
);

select ok(
  (select new_sidebar from mc_measured) * 50 < (select old_sidebar from mc_measured),
  format('the sidebar read no longer scales with community size (%s rows and falling, was %s)',
         (select new_sidebar from mc_measured), (select old_sidebar from mc_measured))
);

select ok(
  (select old_explore from mc_measured) >= 300,
  format('control: the pre-C-1 Explore count examined the whole membership table (%s rows)',
         (select old_explore from mc_measured))
);

select ok(
  (select new_explore from mc_measured) > 0,
  format('control: the measurement sees the new Explore read touch the membership table (%s rows)',
         (select new_explore from mc_measured))
);

select ok(
  (select new_explore from mc_measured) <= 10,
  format('Explore examines membership rows per community, not per member (%s rows for a 304-member community)',
         (select new_explore from mc_measured))
);

select ok(
  (select new_explore from mc_measured) * 50 < (select old_explore from mc_measured),
  format('Explore no longer scales with community size (%s rows and falling, was %s)',
         (select new_explore from mc_measured), (select old_explore from mc_measured))
);

-- ─── Cleanup ────────────────────────────────────────────────
-- Deleting the community cascade-deletes its memberships (the counter trigger
-- then has no community row to update, and must stay a no-op), and the fixture
-- users and master-data row go with it.

delete from public.communities where id = 'c1c1c1c1-0000-4000-8000-000000000001';
delete from public.users where email like '%@member-count.test';
delete from public.cities where id = 'c1c1c1c1-0000-4000-8000-000000000002';

select is(
  (
    select count(*)::integer
    from public.community_members
    where community_id = 'c1c1c1c1-0000-4000-8000-000000000001'
  ),
  0,
  'cleanup removed the fixture memberships'
);

select is(
  (
    select count(*)::integer
    from public.users
    where email like '%@member-count.test'
  ),
  0,
  'cleanup removed the fixture users'
);

select * from finish();
