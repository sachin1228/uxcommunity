-- ============================================================
-- M-2 (admin path) — The admin member picker page is paginated in the database
--
-- Migration under test: 20260928130000_admin_community_members_page.sql
--
-- The admin member endpoint (GET /api/admin/communities/[id]/members) used to
-- transfer every membership row of the community, slice the requested page in
-- Node and, when searching, run a second query for up to 500 matching user
-- names to intersect in JavaScript. public.get_admin_community_members_page now
-- applies LIMIT/OFFSET itself.
--
-- These assertions pin the properties that matter:
--
--   * ordering is the admin endpoint's own order — joined_at ascending — with a
--     deterministic user_id tie-break (NOT the member endpoint's role grouping);
--   * a page returns exactly the requested rows, consecutive pages are disjoint
--     and cover every member once, a page past the end is empty;
--   * the page carries name + email + role so the route can keep its response
--     shape;
--   * limit/offset are clamped (oversized, non-positive, negative);
--   * total is the community count (from the C-1 counter) or the match count;
--   * the function is service-role only, so the route's admin-session check
--     stays the only way in.
--
-- The read-cost comparison (membership rows examined, old shape vs new) and the
-- 1k → 50k growth measurements live in
-- admin_community_members_page_scale.test.sql, which needs committed fixtures —
-- the statistics collector only publishes a backend's deltas at transaction
-- end, so a rolled-back transaction cannot measure them.
--
-- Fixtures are inserted inside a transaction and rolled back.
-- ============================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(25);

-- ─── Fixture ────────────────────────────────────────────────
-- One 75-member community (three pages: 30 + 30 + 15) with an owner, two
-- admins and 72 members, plus a 400-member community for the clamp checks and
-- an empty community. joined_at is `position / 2` minutes, so positions 30/31
-- and 60/61 tie — exactly on the page boundaries — which is what makes the
-- user_id tie-break observable.

create temporary table adm_fixture as
select gen_random_uuid() as community_id,
       gen_random_uuid() as big_community_id,
       gen_random_uuid() as empty_community_id;

create temporary table adm_users as
select gen_random_uuid() as user_id, series.value as position
from generate_series(1, 75) as series(value);

insert into public.users (id, name, email, password_hash)
select user_id,
       'Admin M-2 fixture ' || lpad(position::text, 3, '0'),
       format('%s@admin-member-page.test', user_id),
       'x'
from adm_users;

insert into public.communities (id, name, type, is_active)
select community_id, 'Admin M-2 fixture', 'interest', true from adm_fixture;
insert into public.communities (id, name, type, is_active)
select big_community_id, 'Admin M-2 fixture (large)', 'interest', true from adm_fixture;
insert into public.communities (id, name, type, is_active)
select empty_community_id, 'Admin M-2 fixture (empty)', 'interest', true from adm_fixture;

insert into public.community_members (community_id, user_id, role, joined_at)
select f.community_id,
       u.user_id,
       case when u.position = 1 then 'owner' when u.position <= 3 then 'admin' else 'member' end,
       timestamptz '2026-01-01 00:00:00+00' + interval '1 minute' * (u.position / 2)
from adm_fixture f, adm_users u;

-- The large community: 400 memberships from 400 fresh users.
create temporary table adm_big_users as
select gen_random_uuid() as user_id, series.value as position
from generate_series(1, 400) as series(value);

insert into public.users (id, name, email, password_hash)
select user_id, 'Admin M-2 big fixture ' || position,
       format('%s@admin-member-page.test', user_id), 'x'
from adm_big_users;

insert into public.community_members (community_id, user_id, role, joined_at)
select f.big_community_id, u.user_id, 'member',
       timestamptz '2026-01-01 00:00:00+00' + interval '1 minute' * u.position
from adm_fixture f, adm_big_users u;

-- The admin endpoint's order: joined_at ascending, then the deterministic
-- user_id tie-break. It deliberately does NOT group owners/admins first.
create temporary view adm_expected as
select user_id,
       row_number() over (order by joined_at, user_id) as expected_position
from public.community_members
where community_id = (select community_id from adm_fixture);

-- ─── 1. The function, the index and the grants ──────────────

select has_function('public', 'get_admin_community_members_page',
  array['uuid', 'text', 'integer', 'integer']);

select has_index('public', 'community_members', 'idx_community_members_joined_at',
  'the index that lets the admin page come from the top of a scan instead of a full sort');

select ok(
  not has_function_privilege('anon',
    'public.get_admin_community_members_page(uuid,text,integer,integer)', 'execute'),
  'anon cannot execute the admin member page function');

select ok(
  not has_function_privilege('authenticated',
    'public.get_admin_community_members_page(uuid,text,integer,integer)', 'execute'),
  'authenticated cannot execute the admin member page function');

select ok(
  has_function_privilege('service_role',
    'public.get_admin_community_members_page(uuid,text,integer,integer)', 'execute'),
  'service_role can execute the admin member page function (the route is the admin boundary)');

-- ─── 2. A page returns exactly the requested rows, in order ─

select is(
  (select count(*)::integer
   from public.get_admin_community_members_page(
     (select community_id from adm_fixture), null, 30, 0)),
  30,
  'page 0 returns exactly 30 members'
);

select is(
  (select array_agg(role order by ord)
   from public.get_admin_community_members_page(
     (select community_id from adm_fixture), null, 3, 0) with ordinality
     as page(user_id, joined_at, role, name, email, total, ord)),
  array['owner', 'admin', 'admin'],
  'the page still carries each member''s role so the picker can flag owner/admin'
);

select is(
  (select array_agg(user_id order by ord)
   from public.get_admin_community_members_page(
     (select community_id from adm_fixture), null, 30, 0) with ordinality
     as page(user_id, joined_at, role, name, email, total, ord)),
  (select array_agg(user_id order by expected_position)
   from adm_expected where expected_position <= 30),
  'page 0 is the first 30 rows of the admin (joined_at, user_id) order'
);

select is(
  (select array_agg(user_id order by ord)
   from public.get_admin_community_members_page(
     (select community_id from adm_fixture), null, 30, 30) with ordinality
     as page(user_id, joined_at, role, name, email, total, ord)),
  (select array_agg(user_id order by expected_position)
   from adm_expected where expected_position between 31 and 60),
  'page 1 is the next 30 rows of the same order'
);

-- ─── 3. Pages do not overlap and leave nothing out ──────────
-- joined_at ties land exactly on the 30/31 and 60/61 boundaries; only a
-- deterministic tie-break keeps the pages from repeating or skipping a row.

select is(
  (select count(distinct user_id)::integer from (
     select user_id from public.get_admin_community_members_page(
       (select community_id from adm_fixture), null, 30, 0)
     union all
     select user_id from public.get_admin_community_members_page(
       (select community_id from adm_fixture), null, 30, 30)
     union all
     select user_id from public.get_admin_community_members_page(
       (select community_id from adm_fixture), null, 30, 60)
   ) pages),
  75,
  'paging through the community returns each member exactly once'
);

select is(
  (select count(*)::integer
   from public.get_admin_community_members_page(
     (select community_id from adm_fixture), null, 30, 60)),
  15,
  'the last page returns the remaining 15 members'
);

select is(
  (select count(*)::integer
   from public.get_admin_community_members_page(
     (select community_id from adm_fixture), null, 30, 90)),
  0,
  'a page past the end is empty'
);

select is(
  (select count(*)::integer
   from public.get_admin_community_members_page(
     (select community_id from adm_fixture), null, 30, 300)),
  0,
  'a far page beyond the end is empty'
);

-- The database, not the route, owns the page: asking for one page of a
-- 75-member community returns 30 rows while total still reports 75. This is the
-- property that replaced the old fetch-everything-then-slice behaviour.
select ok(
  (select count(*) from public.get_admin_community_members_page(
     (select community_id from adm_fixture), null, 30, 0)) = 30
  and
  (select distinct total from public.get_admin_community_members_page(
     (select community_id from adm_fixture), null, 30, 0)) = 75,
  'the database returns one bounded page, never the whole community'
);

-- ─── 4. total ───────────────────────────────────────────────

select is(
  (select distinct total::integer
   from public.get_admin_community_members_page(
     (select community_id from adm_fixture), null, 30, 0)),
  75,
  'total is the community member count'
);

select is(
  (select distinct total::integer
   from public.get_admin_community_members_page(
     (select community_id from adm_fixture), null, 30, 60)),
  75,
  'total does not shrink on a later page'
);

-- ─── 5. Limits and offsets are clamped ──────────────────────

select is(
  (select count(*)::integer
   from public.get_admin_community_members_page(
     (select big_community_id from adm_fixture), null, 1000, 0)),
  100,
  'an oversized limit is capped at 100 rows'
);

select is(
  (select count(*)::integer
   from public.get_admin_community_members_page(
     (select big_community_id from adm_fixture), null, -5, 0)),
  1,
  'a non-positive limit still returns one bounded row, never everything'
);

select is(
  (select count(*)::integer
   from public.get_admin_community_members_page(
     (select big_community_id from adm_fixture), null, 30, -10)),
  30,
  'a negative offset is clamped to the first page'
);

-- ─── 6. Search ──────────────────────────────────────────────
-- Names are 'Admin M-2 fixture 001' … '075'.

select is(
  (select count(*)::integer
   from public.get_admin_community_members_page(
     (select community_id from adm_fixture), 'fixture 07', 30, 0)),
  6,
  'search returns only the matching members, in one bounded page'
);

select is(
  (select distinct total::integer
   from public.get_admin_community_members_page(
     (select community_id from adm_fixture), 'fixture 07', 30, 0)),
  6,
  'a search reports the match count, not the community count'
);

select is(
  (select count(*)::integer
   from public.get_admin_community_members_page(
     (select community_id from adm_fixture), 'no-such-member', 30, 0)),
  0,
  'a search with no matches returns an empty page'
);

-- ─── 7. The page carries the fields the route returns ───────

select ok(
  (select bool_and(
     p.name = 'Admin M-2 fixture ' || lpad(u.position::text, 3, '0')
     and p.email = format('%s@admin-member-page.test', u.user_id))
   from public.get_admin_community_members_page(
     (select community_id from adm_fixture), null, 30, 0) p
   join adm_users u on u.user_id = p.user_id),
  'every row carries the member''s name and email for the picker'
);

-- ─── 8. An empty community ──────────────────────────────────

select is(
  (select count(*)::integer
   from public.get_admin_community_members_page(
     (select empty_community_id from adm_fixture), null, 30, 0)),
  0,
  'an empty community returns an empty page'
);

-- ─── Cleanup ────────────────────────────────────────────────

delete from public.communities
where id in (select community_id from adm_fixture
             union all select big_community_id from adm_fixture
             union all select empty_community_id from adm_fixture);
delete from public.users where email like '%@admin-member-page.test';

select is(
  (select count(*)::integer from public.users where email like '%@admin-member-page.test'),
  0,
  'cleanup removed the fixture users'
);

select * from finish();
rollback;
