-- ============================================================
-- M-2 (admin path) — what an admin member page costs as a community grows
--
-- Migration under test: 20260928130000_admin_community_members_page.sql
--
-- The admin member picker used to transfer every membership row of a community
-- and slice the requested page in Node. This file measures the read at
-- 1k / 5k / 10k / 25k / 50k members and shows that a page request is answered
-- by a bounded index read rather than by a fetch of the whole community.
--
-- Read cost cannot be shown inside one transaction — the statistics collector
-- only publishes a backend's deltas at transaction end — so every measurement
-- below is its own top-level statement, and the "membership rows examined"
-- figures are read from pg_stat_all_tables / pg_stat_all_indexes with
-- pg_sleep between the reads (the same technique as member_count_scale.test.sql
-- and community_members_page_scale.test.sql). The fixture is committed, so the
-- file clears its own leftovers first and cleans up after itself: the files
-- after it share the same scratch database.
--
-- What is established for every size:
--   * rows examined  — old shape (fetch the community) vs new shape (one page)
--   * rows returned  — exactly the 30-row production page
--   * query time     — the page read measured against the full fetch
--   * index use      — the page query is planned onto idx_community_members_joined_at
--   * full sort/scan — the page query neither scans nor sorts the community
--
-- The invariant under test is that page retrieval does not become a
-- full-community fetch:
--
--   1k members  → page read          50k members → page read
--
-- Latency is reported as measured. It is not asserted to be constant, because a
-- table larger than RAM, a cold cache or a deep OFFSET all add real time; the
-- bounded property pinned here is rows examined and rows returned.
-- ============================================================

create extension if not exists pgtap with schema extensions;
select plan(12);

-- ─── Fixture ────────────────────────────────────────────────
-- One community, fixed id so cleanup can name it in SQL text, grown from 1k to
-- 50k members (position 1 is the owner, so the size is exact).

delete from public.communities where id = '3b3b3b3b-0000-4000-8000-000000000001';
delete from public.users where email like '%@admin-member-page-scale.test';

insert into public.communities (id, name, type, is_active)
values ('3b3b3b3b-0000-4000-8000-000000000001', 'Admin M-2 scale fixture', 'interest', true);

-- Adds members at positions low..high with unique users and strictly
-- increasing joined_at, so the fixture has a total join order.
create or replace function pg_temp.grow(low integer, high integer) returns void
language sql as $$
  insert into public.users (id, name, email, password_hash)
  select md5('agm2-' || n::text)::uuid,
         'Admin M-2 scale ' || lpad(n::text, 6, '0'),
         format('scale-%s@admin-member-page-scale.test', n),
         'x'
  from generate_series(low, high) as n;

  insert into public.community_members (community_id, user_id, role, joined_at)
  select '3b3b3b3b-0000-4000-8000-000000000001',
         md5('agm2-' || n::text)::uuid,
         case when n = 1 then 'owner' else 'member' end,
         timestamptz '2026-01-01 00:00:00+00' + interval '1 second' * n
  from generate_series(low, high) as n;
$$;

-- ─── Measurement helpers ────────────────────────────────────
-- Heap rows read by sequential scans, heap rows fetched through an index, and
-- index entries read (an index-only scan shows up in the last one only).
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

-- The old shape: every membership row of the community. This is the row set the
-- admin route transferred and then sliced in JavaScript.
create or replace function pg_temp.every_member() returns bigint
language sql as $$
  select count(*) from (
    select user_id, joined_at, role
    from public.community_members
    where community_id = '3b3b3b3b-0000-4000-8000-000000000001'
    order by joined_at asc
  ) every_member;
$$;

-- Wall-clock milliseconds for one full fetch / one page, averaged over a few
-- runs to take the edge off a single cold read.
create or replace function pg_temp.full_fetch_ms(runs integer) returns numeric
language plpgsql as $$
declare i integer; t0 timestamptz; acc numeric := 0;
begin
  for i in 1..runs loop
    t0 := clock_timestamp();
    perform pg_temp.every_member();
    acc := acc + extract(epoch from clock_timestamp() - t0) * 1000.0;
  end loop;
  return acc / runs;
end $$;

create or replace function pg_temp.page_ms(runs integer) returns numeric
language plpgsql as $$
declare i integer; t0 timestamptz; acc numeric := 0; n bigint;
begin
  for i in 1..runs loop
    t0 := clock_timestamp();
    select count(*) into n from public.get_admin_community_members_page(
      '3b3b3b3b-0000-4000-8000-000000000001', null, 30, 0);
    acc := acc + extract(epoch from clock_timestamp() - t0) * 1000.0;
  end loop;
  return acc / runs;
end $$;

-- Plan text for a query, so index use and a full sort/scan can be asserted even
-- though EXPLAIN cannot see inside the function (a plpgsql body is a Function
-- Scan; the function's own query is planned the same way when run directly).
create or replace function pg_temp.plans(q text) returns text
language plpgsql as $$
declare line text; acc text := '';
begin
  for line in execute 'explain ' || q loop
    acc := acc || line || E'\n';
  end loop;
  return acc;
end $$;

create temporary table agm2_cost (
  position   serial primary key,
  members    integer,
  stage      text,
  cumulative bigint
);

create temporary table agm2_page (
  members   integer primary key,
  page_rows integer,
  total     bigint,
  old_ms    numeric,
  new_ms    numeric
);

-- ─── 1,000 members ──────────────────────────────────────────

select pg_temp.grow(1, 1000);
analyze public.community_members;
analyze public.users;

select pg_sleep(1.5);
insert into agm2_cost (members, stage, cumulative)
values (1000, 'baseline', pg_temp.member_rows_examined());

select pg_temp.every_member();
select pg_sleep(1.5);
insert into agm2_cost (members, stage, cumulative)
values (1000, 'old', pg_temp.member_rows_examined());

insert into agm2_page (members, page_rows, total)
select 1000, count(*), max(total)
from public.get_admin_community_members_page(
  '3b3b3b3b-0000-4000-8000-000000000001', null, 30, 0);
select pg_sleep(1.5);
insert into agm2_cost (members, stage, cumulative)
values (1000, 'new', pg_temp.member_rows_examined());

update agm2_page set old_ms = pg_temp.full_fetch_ms(3), new_ms = pg_temp.page_ms(5)
where members = 1000;

-- ─── 5,000 members ──────────────────────────────────────────

select pg_temp.grow(1001, 5000);
analyze public.community_members;
analyze public.users;

select pg_sleep(1.5);
insert into agm2_cost (members, stage, cumulative)
values (5000, 'baseline', pg_temp.member_rows_examined());

select pg_temp.every_member();
select pg_sleep(1.5);
insert into agm2_cost (members, stage, cumulative)
values (5000, 'old', pg_temp.member_rows_examined());

insert into agm2_page (members, page_rows, total)
select 5000, count(*), max(total)
from public.get_admin_community_members_page(
  '3b3b3b3b-0000-4000-8000-000000000001', null, 30, 0);
select pg_sleep(1.5);
insert into agm2_cost (members, stage, cumulative)
values (5000, 'new', pg_temp.member_rows_examined());

update agm2_page set old_ms = pg_temp.full_fetch_ms(3), new_ms = pg_temp.page_ms(5)
where members = 5000;

-- ─── 10,000 members ─────────────────────────────────────────

select pg_temp.grow(5001, 10000);
analyze public.community_members;
analyze public.users;

select pg_sleep(1.5);
insert into agm2_cost (members, stage, cumulative)
values (10000, 'baseline', pg_temp.member_rows_examined());

select pg_temp.every_member();
select pg_sleep(1.5);
insert into agm2_cost (members, stage, cumulative)
values (10000, 'old', pg_temp.member_rows_examined());

insert into agm2_page (members, page_rows, total)
select 10000, count(*), max(total)
from public.get_admin_community_members_page(
  '3b3b3b3b-0000-4000-8000-000000000001', null, 30, 0);
select pg_sleep(1.5);
insert into agm2_cost (members, stage, cumulative)
values (10000, 'new', pg_temp.member_rows_examined());

update agm2_page set old_ms = pg_temp.full_fetch_ms(3), new_ms = pg_temp.page_ms(5)
where members = 10000;

-- ─── 25,000 members ─────────────────────────────────────────

select pg_temp.grow(10001, 25000);
analyze public.community_members;
analyze public.users;

select pg_sleep(1.5);
insert into agm2_cost (members, stage, cumulative)
values (25000, 'baseline', pg_temp.member_rows_examined());

select pg_temp.every_member();
select pg_sleep(1.5);
insert into agm2_cost (members, stage, cumulative)
values (25000, 'old', pg_temp.member_rows_examined());

insert into agm2_page (members, page_rows, total)
select 25000, count(*), max(total)
from public.get_admin_community_members_page(
  '3b3b3b3b-0000-4000-8000-000000000001', null, 30, 0);
select pg_sleep(1.5);
insert into agm2_cost (members, stage, cumulative)
values (25000, 'new', pg_temp.member_rows_examined());

update agm2_page set old_ms = pg_temp.full_fetch_ms(3), new_ms = pg_temp.page_ms(5)
where members = 25000;

-- ─── 50,000 members ─────────────────────────────────────────

select pg_temp.grow(25001, 50000);
analyze public.community_members;
analyze public.users;

select pg_sleep(1.5);
insert into agm2_cost (members, stage, cumulative)
values (50000, 'baseline', pg_temp.member_rows_examined());

select pg_temp.every_member();
select pg_sleep(1.5);
insert into agm2_cost (members, stage, cumulative)
values (50000, 'old', pg_temp.member_rows_examined());

insert into agm2_page (members, page_rows, total)
select 50000, count(*), max(total)
from public.get_admin_community_members_page(
  '3b3b3b3b-0000-4000-8000-000000000001', null, 30, 0);
select pg_sleep(1.5);
insert into agm2_cost (members, stage, cumulative)
values (50000, 'new', pg_temp.member_rows_examined());

update agm2_page set old_ms = pg_temp.full_fetch_ms(3), new_ms = pg_temp.page_ms(5)
where members = 50000;

-- ─── Derive rows examined from the cumulative readings ──────

create temporary view agm2_measured as
select members,
       stage,
       cumulative - lag(cumulative) over (order by position) as examined
from agm2_cost;

create temporary view agm2_result as
select p.members,
       (select examined from agm2_measured m
         where m.members = p.members and m.stage = 'old') as old_rows,
       (select examined from agm2_measured m
         where m.members = p.members and m.stage = 'new') as new_rows,
       p.page_rows,
       p.total,
       p.old_ms,
       p.new_ms
from agm2_page p;

-- ─── 1. Every size was measured ─────────────────────────────

select is(
  (select count(*)::integer from agm2_result),
  5,
  'the page read was measured at five dataset sizes (1k / 5k / 10k / 25k / 50k)'
);

-- ─── 2. The fixture and the C-1 counter agree at every size ─

select is(
  (select count(*)::integer from agm2_result where total = members),
  5,
  format('the reported total equals the community size at every scale (totals: %s)',
         (select string_agg(total::text, ', ' order by members) from agm2_result))
);

-- ─── 3. One production page, at every size ──────────────────

select ok(
  (select bool_and(page_rows = 30) from agm2_result),
  format('every size returns exactly the 30-row production page (rows: %s)',
         (select string_agg(page_rows::text, ', ' order by members) from agm2_result))
);

-- ─── 4. Control: the old shape examines the community ───────

select ok(
  (select bool_and(old_rows >= members) from agm2_result),
  format('control: the old fetch-everything shape examines at least one row per member at every size (rows: %s)',
         (select string_agg(old_rows::text, ', ' order by members) from agm2_result))
);

-- ─── 5. The page examines a bounded number of rows ──────────

select ok(
  (select bool_and(new_rows <= 120) from agm2_result),
  format('one 30-row admin page stays bounded at every size (membership rows examined: %s)',
         (select string_agg(new_rows::text, ', ' order by members) from agm2_result))
);

select ok(
  (select new_rows from agm2_result where members = 50000)
    <= (select new_rows from agm2_result where members = 1000) + 64,
  format('rows examined for a page does not grow with the community (%s rows at 1k, %s rows at 50k)',
         (select new_rows from agm2_result where members = 1000),
         (select new_rows from agm2_result where members = 50000))
);

-- ─── 6. The page query is planned onto the page index ───────
-- The function's own query, planned directly at 50k members.

select ok(
  pg_temp.plans($q$select m.user_id, m.joined_at, m.role, u.name, u.email
                   from public.community_members m
                   join public.users u on u.id = m.user_id
                  where m.community_id = '3b3b3b3b-0000-4000-8000-000000000001'
                  order by m.joined_at asc, m.user_id asc
                  limit 30$q$)
  like '%idx_community_members_joined_at%',
  'at 50k members the page query is served by idx_community_members_joined_at'
);

select ok(
  pg_temp.plans($q$select m.user_id, m.joined_at, m.role, u.name, u.email
                   from public.community_members m
                   join public.users u on u.id = m.user_id
                  where m.community_id = '3b3b3b3b-0000-4000-8000-000000000001'
                  order by m.joined_at asc, m.user_id asc
                  limit 30$q$)
  not like '%Seq Scan on community_members%',
  'at 50k members the page query does not sequentially scan the community''s memberships'
);

select ok(
  pg_temp.plans($q$select m.user_id, m.joined_at, m.role, u.name, u.email
                   from public.community_members m
                   join public.users u on u.id = m.user_id
                  where m.community_id = '3b3b3b3b-0000-4000-8000-000000000001'
                  order by m.joined_at asc, m.user_id asc
                  limit 30$q$)
  not like '%Sort Key: m.joined_at%',
  'at 50k members the page query reads its order from the index instead of sorting the community'
);

-- A deep page — the picker's "Load more", page 100 at 50k members — must still
-- be an index walk rather than a sort of the whole community.
--
-- OFFSET is itself O(offset): an extreme offset (e.g. 25000, which no picker
-- reaches by clicking "Load more") makes the planner prefer a scan + sort over
-- walking 25k index entries. That is a property of OFFSET, it is the same on
-- the normal member endpoint, and it is not what this change is about — the
-- page read here does not transfer the community either way.
select ok(
  pg_temp.plans($q$select m.user_id, m.joined_at, m.role, u.name, u.email
                   from public.community_members m
                   join public.users u on u.id = m.user_id
                  where m.community_id = '3b3b3b3b-0000-4000-8000-000000000001'
                  order by m.joined_at asc, m.user_id asc
                  limit 30 offset 3000$q$)
  like '%idx_community_members_joined_at%'
  and pg_temp.plans($q$select m.user_id, m.joined_at, m.role, u.name, u.email
                      from public.community_members m
                      join public.users u on u.id = m.user_id
                     where m.community_id = '3b3b3b3b-0000-4000-8000-000000000001'
                     order by m.joined_at asc, m.user_id asc
                     limit 30 offset 3000$q$)
  not like '%Sort Key: m.joined_at%',
  'a deep page (page 100 at 50k members) is still an index walk, not a community sort'
);

-- ─── 7. Page latency against the full fetch, at 50k ─────────
-- Reported for the record; the bounded invariant is the rows above.

select ok(
  (select new_ms from agm2_result where members = 50000)
    < (select old_ms from agm2_result where members = 50000),
  format('at 50k members one page is faster than the full-community fetch (page %sms vs fetch %sms)',
         round((select new_ms from agm2_result where members = 50000), 2),
         round((select old_ms from agm2_result where members = 50000), 2))
);

-- ─── Measurements, for the run log ──────────────────────────

select members,
       old_rows  as full_fetch_rows,
       new_rows  as page_rows_examined,
       page_rows as rows_returned,
       round(old_ms, 3) as full_fetch_ms,
       round(new_ms, 3) as page_ms
from agm2_result
order by members;

-- ─── Cleanup ────────────────────────────────────────────────

delete from public.communities where id = '3b3b3b3b-0000-4000-8000-000000000001';
delete from public.users where email like '%@admin-member-page-scale.test';

select is(
  (select count(*)::integer from public.users where email like '%@admin-member-page-scale.test'),
  0,
  'cleanup removed the scale fixture'
);

select * from finish();
