-- ⚠️ TEST FILE — NEVER RUN THIS IN THE SUPABASE SQL EDITOR or against any
-- non-scratch database. It seeds fixture users/communities and calls
-- admin_join_all_communities, which joins a throwaway member into EVERY
-- community that exists. It runs only through supabase/tests/run-local.sh,
-- which builds a throwaway database. To enforce the limits in the real
-- project, run the creation-limits migrations from supabase/migrations/
-- (20261013120000, 20261014120000, 20261014140000, 20261014160000 and
-- 20261022190000).
-- ============================================================
-- Creation limits — the per-member budgets
-- ============================================================
-- Exercised through the real triggers and RPCs, exactly the way
-- production writes hit them:
--
--   * threads, showcase posts and resources share one 3-a-day budget
--   * five events per UTC month, three job posts per UTC month
--   * five LIVE member-created communities at a time — deleting one returns
--     the budget (counted like the sidebar), and creating needs a join slot
--   * ten LIVE communities at a time — event rooms excluded, deactivated
--     and ownerless rooms not charged (count_join_slots)
--   * five NEW DM conversations a month, existing pairs never capped
--
-- The referee for posts/events/jobs/communities/joins is the count of LIVE
-- rows inside the window, so deleting content gives the slot back — pinned
-- below for every one of them. New-DM conversations stay append-only in
-- usage_counters: a conversation is not deleted the way a post is, so the
-- counter is the only record of who was started. Closing a job post keeps
-- counting (only deleting frees it), an idempotent re-join at the cap is not
-- refused, a deactivated community stops consuming a slot, creating at the
-- join cap is refused, a moderation undo is not charged as a new post, the
-- admin override joins past the cap, and the bypass flag never leaks.
--
-- Namespace: c9c9c9c9-* (fresh; see the harness note about shared DBs).
-- ============================================================

-- Idempotence for re-runs against a database that already saw this file.
delete from public.usage_counters where user_id::text like 'c9c9c9c9-%';
delete from public.content_removals where content_id::text like 'c9c9c9c9-%';
delete from public.job_posts where poster_id::text like 'c9c9c9c9-%';
delete from public.community_events where user_id::text like 'c9c9c9c9-%';
delete from public.community_resources where user_id::text like 'c9c9c9c9-%';
delete from public.community_showcase_posts where user_id::text like 'c9c9c9c9-%';
delete from public.community_threads where user_id::text like 'c9c9c9c9-%';
delete from public.community_members where user_id::text like 'c9c9c9c9-%';
delete from public.communities where id::text like 'c9c9c9c9-%';
delete from public.company_members where company_id::text like 'c9c9c9c9-%';
delete from public.users where id::text like 'c9c9c9c9-%';
delete from public.companies where id::text like 'c9c9c9c9-%';
delete from public.cities where id::text like 'c9c9c9c9-%';
delete from public.design_sectors where id::text like 'c9c9c9c9-%';

-- ─── Fixtures ───────────────────────────────────────────────
insert into public.users (id, name, email, password_hash, application_id) values
  ('c9c9c9c9-0000-4000-8000-000000000001', 'Poster Daily',    'daily@limits.test',   'x', null),
  ('c9c9c9c9-0000-4000-8000-000000000002', 'Event Host',     'evhost@limits.test',  'x', null),
  ('c9c9c9c9-0000-4000-8000-000000000003', 'Job Poster',     'jobposter@limits.test','x', null),
  ('c9c9c9c9-0000-4000-8000-000000000004', 'Community Maker','maker@limits.test',   'x', null),
  ('c9c9c9c9-0000-4000-8000-000000000005', 'Joiner',         'joiner@limits.test',  'x', null),
  ('c9c9c9c9-0000-4000-8000-000000000006', 'DM Starter',     'dmstarter@limits.test','x', null),
  ('c9c9c9c9-0000-4000-8000-000000000007', 'DM Peer 1',      'dm1@limits.test',     'x', null),
  ('c9c9c9c9-0000-4000-8000-000000000008', 'DM Peer 2',      'dm2@limits.test',     'x', null),
  ('c9c9c9c9-0000-4000-8000-000000000009', 'DM Peer 3',      'dm3@limits.test',     'x', null),
  ('c9c9c9c9-0000-4000-8000-00000000000a', 'DM Peer 4',      'dm4@limits.test',     'x', null),
  ('c9c9c9c9-0000-4000-8000-00000000000b', 'DM Peer 5',      'dm5@limits.test',     'x', null),
  ('c9c9c9c9-0000-4000-8000-00000000000c', 'DM Peer 6',      'dm6@limits.test',     'x', null);

-- Twelve joinable communities (plain 'city' type) + one event room: enough
-- headroom to fill the ten-slot cap, refuse an eleventh, and still have a
-- spare to land after a leave.
insert into public.communities (id, name, type, is_active) values
  ('c9c9c9c9-1111-4000-8000-000000000001', 'Limits City 1', 'city', true),
  ('c9c9c9c9-1111-4000-8000-000000000002', 'Limits City 2', 'city', true),
  ('c9c9c9c9-1111-4000-8000-000000000003', 'Limits City 3', 'city', true),
  ('c9c9c9c9-1111-4000-8000-000000000004', 'Limits City 4', 'city', true),
  ('c9c9c9c9-1111-4000-8000-000000000005', 'Limits City 5', 'city', true),
  ('c9c9c9c9-1111-4000-8000-000000000006', 'Limits City 6', 'city', true),
  ('c9c9c9c9-1111-4000-8000-000000000007', 'Limits City 7', 'city', true),
  ('c9c9c9c9-1111-4000-8000-000000000008', 'Limits City 8', 'city', true),
  ('c9c9c9c9-1111-4000-8000-000000000009', 'Limits City 9', 'city', true),
  ('c9c9c9c9-1111-4000-8000-00000000000a', 'Limits City 10', 'city', true),
  ('c9c9c9c9-1111-4000-8000-00000000000b', 'Limits City 11', 'city', true),
  ('c9c9c9c9-1111-4000-8000-00000000000c', 'Limits City 12', 'city', true),
  ('c9c9c9c9-2222-4000-8000-000000000001', 'Limits Event Room', 'event', true);

insert into public.cities (id, name, is_active) values
  ('c9c9c9c9-3333-4000-8000-000000000001', 'Limitsville', true);
insert into public.design_sectors (id, name, is_active) values
  ('c9c9c9c9-3333-4000-8000-000000000002', 'Limits Design', true);
insert into public.companies (id, name, slug, is_active) values
  ('c9c9c9c9-3333-4000-8000-000000000003', 'Limitsco', 'limitsco', true);

-- Local helpers: the stand-in throws_ok only compares SQLSTATE, but the
-- messages ARE the contract (the app maps `limit:<kind>`), so read them.
create or replace function public.limit_failure(stmt text) returns text
language plpgsql as $$
declare msg text;
begin
  begin
    execute stmt;
  exception when others then
    get stacked diagnostics msg = message_text;
    return msg;
  end;
  return '<no exception>';
end $$;

-- The month key still addresses the one budget that stays counter-backed.
create or replace function public.limits_month_key() returns text
language sql stable as $$
  select to_char(now() at time zone 'utc', 'YYYY-MM')
$$;

select plan(63);

-- ─── 1. Shape of the machinery ──────────────────────────────
select has_function('public', 'bump_usage_counter', 'bump_usage_counter(...) exists (DMs still use it)');
select has_function('public', 'enforce_membership_cap', 'the membership cap trigger function exists');
select has_function('public', 'admin_join_all_communities', 'the operator override RPC exists');
select has_function('public', 'count_join_slots', 'the live-count helper exists');
select has_function('public', 'count_live_creations', 'the live-row budget helper exists');
select has_function('public', 'is_content_restore', 'the moderation-undo exemption exists');
select is(
  (select count(*) from public.creation_limits)::integer,
  6, 'the six budgets are seeded'
);
select is(
  (select string_agg(kind || '=' || limit_count, ', ' order by kind)
     from public.creation_limits),
  'communities_total=5, community_joins=10, dms_monthly=5, events_monthly=5, jobs_monthly=3, posts_daily=3',
  'the budgets read 3 posts / 5 events / 3 jobs / 5 DMs / 5 own communities / 10 joins'
);

-- ─── 2. Posts: 3 a day, three content types, deleting refunds ──

with ins as (
  insert into public.community_threads (community_id, user_id, title, category)
  values ('c9c9c9c9-1111-4000-8000-000000000001',
          'c9c9c9c9-0000-4000-8000-000000000001', 'Daily post 1', 'question')
  returning id
)
select ok(count(*) = 1, 'a daily post is accepted (1 of 3)') from ins;

with ins as (
  insert into public.community_resources (community_id, user_id, title, resource_type, url)
  values ('c9c9c9c9-1111-4000-8000-000000000002',
          'c9c9c9c9-0000-4000-8000-000000000001', 'Daily resource', 'article',
          'https://cdn.limits.test/guide')
  returning id
)
select ok(count(*) = 1, 'a shared resource spends the same daily budget (2 of 3)') from ins;

with ins as (
  insert into public.community_showcase_posts
    (community_id, user_id, title, image_url, category)
  values ('c9c9c9c9-1111-4000-8000-000000000003',
          'c9c9c9c9-0000-4000-8000-000000000001',
          'Showcase post', 'https://cdn.limits.test/x.png', 'ui_design')
  returning id
)
select ok(count(*) = 1, 'a showcase post spends the same daily budget (3 of 3)') from ins;

select is(
  public.limit_failure($$
    insert into public.community_resources (community_id, user_id, title, resource_type, url)
    values ('c9c9c9c9-1111-4000-8000-000000000004',
            'c9c9c9c9-0000-4000-8000-000000000001', 'Fourth resource', 'article',
            'https://cdn.limits.test/extra')$$),
  'limit:posts_daily',
  'a resource is refused as the 4th post of the day'
);

select is(
  public.count_live_creations('c9c9c9c9-0000-4000-8000-000000000001', 'posts_daily'),
  3, 'the live count is the budget: three posts are standing today'
);

-- The author deleted their thread. The row is gone from the content table,
-- so the count drops and the slot comes back — the refund this migration is
-- for.
delete from public.community_threads
 where user_id = 'c9c9c9c9-0000-4000-8000-000000000001';

with ins as (
  insert into public.community_threads (community_id, user_id, title, category)
  values ('c9c9c9c9-1111-4000-8000-000000000005',
          'c9c9c9c9-0000-4000-8000-000000000001', 'Repost after delete', 'question')
  returning id
)
select ok(count(*) = 1, 'deleting a post refunds the daily budget') from ins;

select is(
  public.count_live_creations('c9c9c9c9-0000-4000-8000-000000000001', 'posts_daily'),
  3, 'the refunded post lands the count back on the cap, not above it'
);

select is(
  public.limit_failure($$
    insert into public.community_threads (community_id, user_id, title, category)
    values ('c9c9c9c9-1111-4000-8000-000000000006',
            'c9c9c9c9-0000-4000-8000-000000000001', 'One too many', 'question')$$),
  'limit:posts_daily',
  'the cap still holds after a refund-and-repost cycle'
);

select set_config('app.bypass_creation_limits', 'on', false);

with ins as (
  insert into public.community_threads (community_id, user_id, title, category, created_at)
  values ('c9c9c9c9-1111-4000-8000-000000000006',
          'c9c9c9c9-0000-4000-8000-000000000001', 'Seeded post', 'question',
          now() - interval '2 days')
  returning id
)
select ok(count(*) = 1, 'the bypass flag lets fixture seeding past the budget') from ins;

select set_config('app.bypass_creation_limits', 'off', false);

select is(
  public.count_live_creations('c9c9c9c9-0000-4000-8000-000000000001', 'posts_daily'),
  3, 'a bypassed insert charges nothing inside the window'
);

-- ─── 3. Events: five per month, deleting refunds ────────────

with ins as (
  insert into public.community_events (community_id, user_id, title, event_date)
  values
    ('c9c9c9c9-1111-4000-8000-000000000001', 'c9c9c9c9-0000-4000-8000-000000000002', 'Event 1', now() + interval '1 day'),
    ('c9c9c9c9-1111-4000-8000-000000000002', 'c9c9c9c9-0000-4000-8000-000000000002', 'Event 2', now() + interval '2 days'),
    ('c9c9c9c9-1111-4000-8000-000000000003', 'c9c9c9c9-0000-4000-8000-000000000002', 'Event 3', now() + interval '3 days'),
    ('c9c9c9c9-1111-4000-8000-000000000004', 'c9c9c9c9-0000-4000-8000-000000000002', 'Event 4', now() + interval '4 days'),
    ('c9c9c9c9-1111-4000-8000-000000000005', 'c9c9c9c9-0000-4000-8000-000000000002', 'Event 5', now() + interval '5 days')
  returning id
)
select ok(count(*) = 5, 'five hosted events in a month are accepted') from ins;

select is(
  public.limit_failure($$
    insert into public.community_events (community_id, user_id, title, event_date)
    values ('c9c9c9c9-1111-4000-8000-000000000006',
            'c9c9c9c9-0000-4000-8000-000000000002', 'Sixth event', now() + interval '6 days')$$),
  'limit:events_monthly',
  'the 6th event in the same month is refused'
);

delete from public.community_events
 where user_id = 'c9c9c9c9-0000-4000-8000-000000000002'
   and title = 'Event 3';

with ins as (
  insert into public.community_events (community_id, user_id, title, event_date)
  values ('c9c9c9c9-1111-4000-8000-000000000007',
          'c9c9c9c9-0000-4000-8000-000000000002', 'Event after delete', now() + interval '7 days')
  returning id
)
select ok(count(*) = 1, 'deleting an event refunds the monthly budget') from ins;

-- ─── 4. Jobs: three per month, closing does not refund ──────

with ins as (
  insert into public.job_posts
    (poster_id, company_id, kind, title, city_id, sector_id, job_title,
     experience_level, work_mode, employment_type, description)
  values
    ('c9c9c9c9-0000-4000-8000-000000000003', 'c9c9c9c9-3333-4000-8000-000000000003', 'hiring', 'First job',
     'c9c9c9c9-3333-4000-8000-000000000001', 'c9c9c9c9-3333-4000-8000-000000000002',
     'product_designer', 'mid_level', 'remote', 'full_time', 'Design things.'),
    ('c9c9c9c9-0000-4000-8000-000000000003', 'c9c9c9c9-3333-4000-8000-000000000003', 'hiring', 'Second job',
     'c9c9c9c9-3333-4000-8000-000000000001', 'c9c9c9c9-3333-4000-8000-000000000002',
     'product_designer', 'mid_level', 'remote', 'full_time', 'Design more things.'),
    ('c9c9c9c9-0000-4000-8000-000000000003', 'c9c9c9c9-3333-4000-8000-000000000003', 'referral', 'Third job',
     'c9c9c9c9-3333-4000-8000-000000000001', 'c9c9c9c9-3333-4000-8000-000000000002',
     'ux_designer', 'senior', 'hybrid', 'contract', 'Research things.')
  returning id
)
select ok(count(*) = 3, 'three job posts in a month are accepted') from ins;

select is(
  public.limit_failure($$
    insert into public.job_posts
      (poster_id, company_id, kind, title, city_id, sector_id, job_title,
       experience_level, work_mode, employment_type, description)
    values
      ('c9c9c9c9-0000-4000-8000-000000000003', 'c9c9c9c9-3333-4000-8000-000000000003', 'hiring', 'Fourth job',
       'c9c9c9c9-3333-4000-8000-000000000001', 'c9c9c9c9-3333-4000-8000-000000000002',
       'product_designer', 'mid_level', 'remote', 'full_time', 'Design even more.')$$),
  'limit:jobs_monthly',
  'the 4th job post in the same month is refused'
);

-- A closed posting is still a live row: it stays on the board's history and
-- keeps its slot until it is deleted.
update public.job_posts
   set status = 'closed'
 where poster_id = 'c9c9c9c9-0000-4000-8000-000000000003'
   and title = 'Second job';

select is(
  public.limit_failure($$
    insert into public.job_posts
      (poster_id, company_id, kind, title, city_id, sector_id, job_title,
       experience_level, work_mode, employment_type, description)
    values
      ('c9c9c9c9-0000-4000-8000-000000000003', 'c9c9c9c9-3333-4000-8000-000000000003', 'hiring', 'Closed does not free',
       'c9c9c9c9-3333-4000-8000-000000000001', 'c9c9c9c9-3333-4000-8000-000000000002',
       'product_designer', 'mid_level', 'remote', 'full_time', 'Closing is not deleting.')$$),
  'limit:jobs_monthly',
  'closing a job post does not refund the monthly budget'
);

delete from public.job_posts
 where poster_id = 'c9c9c9c9-0000-4000-8000-000000000003'
   and title = 'Second job';

with ins as (
  insert into public.job_posts
    (poster_id, company_id, kind, title, city_id, sector_id, job_title,
     experience_level, work_mode, employment_type, description)
  values
    ('c9c9c9c9-0000-4000-8000-000000000003', 'c9c9c9c9-3333-4000-8000-000000000003', 'hiring', 'Job after delete',
     'c9c9c9c9-3333-4000-8000-000000000001', 'c9c9c9c9-3333-4000-8000-000000000002',
     'product_designer', 'mid_level', 'remote', 'full_time', 'Deleting frees the slot.')
  returning id
)
select ok(count(*) = 1, 'deleting a job post refunds the monthly budget') from ins;

-- ─── 5. Member-created communities: five live, deleting frees one ──

with ins as (
  insert into public.communities (id, name, type, owner_id, is_active)
  values
    ('c9c9c9c9-4444-4000-8000-000000000001', 'My Community 1', 'user', 'c9c9c9c9-0000-4000-8000-000000000004', true),
    ('c9c9c9c9-4444-4000-8000-000000000002', 'My Community 2', 'user', 'c9c9c9c9-0000-4000-8000-000000000004', true),
    ('c9c9c9c9-4444-4000-8000-000000000003', 'My Community 3', 'user', 'c9c9c9c9-0000-4000-8000-000000000004', true),
    ('c9c9c9c9-4444-4000-8000-000000000004', 'My Community 4', 'user', 'c9c9c9c9-0000-4000-8000-000000000004', true),
    ('c9c9c9c9-4444-4000-8000-000000000005', 'My Community 5', 'user', 'c9c9c9c9-0000-4000-8000-000000000004', true)
  returning id
)
select ok(count(*) = 5, 'five member-created communities are accepted') from ins;

-- The app's creation flow adds the owner as a member, and the live count
-- requires them to still be inside the community — the sidebar's own test.
insert into public.community_members (community_id, user_id, role)
select c.id, 'c9c9c9c9-0000-4000-8000-000000000004', 'owner'
  from public.communities as c
 where c.owner_id = 'c9c9c9c9-0000-4000-8000-000000000004';

select is(
  public.limit_failure($$
    insert into public.communities (name, type, owner_id, is_active)
    values ('Sixth Community', 'user',
            'c9c9c9c9-0000-4000-8000-000000000004', true)$$),
  'limit:communities_total',
  'the 6th live member-created community is refused'
);

-- The owner ran the app's Delete button: a soft delete. The row survives
-- (member content stays referenced) but drops out of the sidebar — and out
-- of the creation count with it, handing the budget back.
update public.communities
   set is_active = false
 where id = 'c9c9c9c9-4444-4000-8000-000000000001';

with ins as (
  insert into public.communities (id, name, type, owner_id, is_active)
  values ('c9c9c9c9-4444-4000-8000-000000000006', 'Replacement Community', 'user',
          'c9c9c9c9-0000-4000-8000-000000000004', true)
  returning id
)
select ok(count(*) = 1, 'deleting a community returns its own-community budget') from ins;

-- ─── 6. Memberships: ten live communities, event rooms excluded ──

with ins as (
  insert into public.community_members (community_id, user_id)
  values
    ('c9c9c9c9-1111-4000-8000-000000000001', 'c9c9c9c9-0000-4000-8000-000000000005'),
    ('c9c9c9c9-1111-4000-8000-000000000002', 'c9c9c9c9-0000-4000-8000-000000000005'),
    ('c9c9c9c9-1111-4000-8000-000000000003', 'c9c9c9c9-0000-4000-8000-000000000005'),
    ('c9c9c9c9-1111-4000-8000-000000000004', 'c9c9c9c9-0000-4000-8000-000000000005'),
    ('c9c9c9c9-1111-4000-8000-000000000005', 'c9c9c9c9-0000-4000-8000-000000000005'),
    ('c9c9c9c9-1111-4000-8000-000000000006', 'c9c9c9c9-0000-4000-8000-000000000005'),
    ('c9c9c9c9-1111-4000-8000-000000000007', 'c9c9c9c9-0000-4000-8000-000000000005'),
    ('c9c9c9c9-1111-4000-8000-000000000008', 'c9c9c9c9-0000-4000-8000-000000000005'),
    ('c9c9c9c9-1111-4000-8000-000000000009', 'c9c9c9c9-0000-4000-8000-000000000005'),
    ('c9c9c9c9-1111-4000-8000-00000000000a', 'c9c9c9c9-0000-4000-8000-000000000005')
  returning community_id
)
select ok(count(*) = 10, 'ten communities join fine') from ins;

select is(
  public.limit_failure($$
    insert into public.community_members (community_id, user_id)
    values ('c9c9c9c9-1111-4000-8000-00000000000b',
            'c9c9c9c9-0000-4000-8000-000000000005')$$),
  'limit:community_joins',
  'the 11th community is refused'
);

select is(
  public.limit_failure($$
    insert into public.community_members (community_id, user_id)
    values ('c9c9c9c9-1111-4000-8000-000000000001',
            'c9c9c9c9-0000-4000-8000-000000000005')
    on conflict (community_id, user_id) do nothing$$),
  '<no exception>',
  'an idempotent re-join at the cap is not refused'
);

with ins as (
  insert into public.community_members (community_id, user_id)
  values ('c9c9c9c9-2222-4000-8000-000000000001',
          'c9c9c9c9-0000-4000-8000-000000000005')
  returning community_id
)
select ok(count(*) = 1, 'event group chats are not capped') from ins;

delete from public.community_members
 where community_id = 'c9c9c9c9-1111-4000-8000-000000000007'
   and user_id = 'c9c9c9c9-0000-4000-8000-000000000005';

with ins as (
  insert into public.community_members (community_id, user_id)
  values ('c9c9c9c9-1111-4000-8000-00000000000b',
          'c9c9c9c9-0000-4000-8000-000000000005')
  returning community_id
)
select ok(count(*) = 1, 'leaving a community frees its slot') from ins;

select is(
  public.limit_failure($$
    insert into public.community_members (community_id, user_id)
    values ('c9c9c9c9-1111-4000-8000-00000000000c',
            'c9c9c9c9-0000-4000-8000-000000000005')$$),
  'limit:community_joins',
  'the cap re-engages at ten'
);

-- The owner ran "Delete Community" on one of the ten: the row survives
-- (the soft delete keeps other members' content referenced), but the room
-- disappears from the sidebar and its leave route 404s. A room a member
-- cannot see or exit must not hold a slot — the count is of LIVE
-- communities only.
update public.communities
   set is_active = false
 where id = 'c9c9c9c9-1111-4000-8000-000000000008';

select is(
  public.count_join_slots('c9c9c9c9-0000-4000-8000-000000000005'),
  9,
  'a deactivated community drops out of the live count'
);

with ins as (
  insert into public.community_members (community_id, user_id)
  values ('c9c9c9c9-1111-4000-8000-00000000000c',
          'c9c9c9c9-0000-4000-8000-000000000005')
  returning community_id
)
select ok(count(*) = 1, 'its slot is free — the previously refused 11th join lands') from ins;

-- Creating a community makes its owner a member, so a member already in
-- ten live communities cannot create on top of that — the creation answers
-- with the join-cap kind.
select is(
  public.limit_failure($$
    insert into public.communities (name, type, owner_id, is_active)
    values ('Capped Creation', 'user',
            'c9c9c9c9-0000-4000-8000-000000000005', true)$$),
  'limit:community_joins',
  'creating a community is refused while the member is in ten'
);

-- ─── 7. DMs: five NEW conversations a month, append-only ────

with c as (
  select * from public.get_or_create_dm_conversation(
    'c9c9c9c9-0000-4000-8000-000000000006', 'c9c9c9c9-0000-4000-8000-000000000007')
  union all
  select * from public.get_or_create_dm_conversation(
    'c9c9c9c9-0000-4000-8000-000000000006', 'c9c9c9c9-0000-4000-8000-000000000008')
  union all
  select * from public.get_or_create_dm_conversation(
    'c9c9c9c9-0000-4000-8000-000000000006', 'c9c9c9c9-0000-4000-8000-000000000009')
  union all
  select * from public.get_or_create_dm_conversation(
    'c9c9c9c9-0000-4000-8000-000000000006', 'c9c9c9c9-0000-4000-8000-00000000000a')
  union all
  select * from public.get_or_create_dm_conversation(
    'c9c9c9c9-0000-4000-8000-000000000006', 'c9c9c9c9-0000-4000-8000-00000000000b')
)
select ok(count(*) = 5, 'five new conversations start within the monthly budget') from c;

select is(
  public.limit_failure($$
    select * from public.get_or_create_dm_conversation(
      'c9c9c9c9-0000-4000-8000-000000000006', 'c9c9c9c9-0000-4000-8000-00000000000c')$$),
  'limit:dms_monthly',
  'the 6th new conversation of the month is refused'
);

select is(
  public.limit_failure($$
    select * from public.get_or_create_dm_conversation(
      'c9c9c9c9-0000-4000-8000-000000000006', 'c9c9c9c9-0000-4000-8000-000000000007')$$),
  '<no exception>',
  'an existing conversation is never capped'
);

select is(
  public.limit_failure($$
    select * from public.get_or_create_dm_conversation(
      'c9c9c9c9-0000-4000-8000-000000000007', 'c9c9c9c9-0000-4000-8000-000000000006')$$),
  '<no exception>',
  'the same pair in reverse order is the same conversation'
);

select is(
  public.limit_failure($$
    select * from public.get_or_create_dm_conversation(
      'c9c9c9c9-0000-4000-8000-000000000007', 'c9c9c9c9-0000-4000-8000-00000000000c')$$),
  '<no exception>',
  'receiving a conversation does not spend the receiver''s budget'
);

select is(
  (select count from public.usage_counters
    where user_id = 'c9c9c9c9-0000-4000-8000-000000000006'
      and kind = 'dms_monthly' and period_key = public.limits_month_key()),
  5,
  'the starter''s counter holds exactly five'
);

select is(
  public.count_live_creations('c9c9c9c9-0000-4000-8000-000000000006', 'dms_monthly'),
  0,
  'DMs are deliberately not live-counted — the counter stays the referee'
);

-- ─── 8. The operator override ───────────────────────────────

select ok(
  public.admin_join_all_communities('c9c9c9c9-0000-4000-8000-000000000005') > 10,
  'the admin override joins past the ten-community cap'
);

-- Give the shared database back: the override joined this member into every
-- community that exists right now, including fixtures other test files have
-- seeded. Those memberships are this file's side effect, so they are removed
-- (the member's own c9c9c9c9-* rows stay).
delete from public.community_members
 where user_id = 'c9c9c9c9-0000-4000-8000-000000000005'
   and community_id::text not like 'c9c9c9c9-%';

insert into public.communities (id, name, type, owner_id, is_active)
values ('c9c9c9c9-4444-4000-8000-00000000000a', 'Post-Override Community', 'user',
        'c9c9c9c9-0000-4000-8000-000000000002', true);

select is(
  public.limit_failure($$
    insert into public.community_members (community_id, user_id)
    values ('c9c9c9c9-4444-4000-8000-00000000000a',
            'c9c9c9c9-0000-4000-8000-000000000005')$$),
  'limit:community_joins',
  'the admin bypass did not leak out of its own transaction'
);

select * from finish();
