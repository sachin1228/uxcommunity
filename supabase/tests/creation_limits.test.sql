-- ⚠️ TEST FILE — NEVER RUN THIS IN THE SUPABASE SQL EDITOR or against any
-- non-scratch database. It seeds fixture users/communities and calls
-- admin_join_all_communities, which joins a throwaway member into EVERY
-- community that exists. It runs only through supabase/tests/run-local.sh,
-- which builds a throwaway database. To enforce the limits in the real
-- project, run supabase/migrations/20261013120000_creation_limits.sql.
-- ============================================================
-- Creation limits — the per-member budgets
-- ============================================================
-- Exercised through the real triggers and RPCs, exactly the way
-- production writes hit them:
--
--   * threads and showcase posts share one 3-a-day budget
--   * one event per UTC month, one job post per UTC month
--   * one member-created community, lifetime
--   * seven real communities at a time, event rooms excluded
--   * five NEW DM conversations a month, existing pairs never capped
--
-- Also pinned here: deleting content does not refund a period budget
-- (the counter is append-only — delete/repost churn is the bypass this
-- closes), an idempotent re-join at the cap is not refused, the admin
-- override joins past the cap, and the bypass flag never leaks.
--
-- Namespace: c9c9c9c9-* (fresh; see the harness note about shared DBs).
-- ============================================================

-- Idempotence for re-runs against a database that already saw this file.
delete from public.usage_counters where user_id::text like 'c9c9c9c9-%';
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

-- Nine joinable communities (plain 'city' type) + one event room.
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
  ('c9c9c9c9-2222-4000-8000-000000000001', 'Limits Event Room', 'event', true);

insert into public.cities (id, name, is_active) values
  ('c9c9c9c9-3333-4000-8000-000000000001', 'Limitsville', true);
insert into public.design_sectors (id, name, is_active) values
  ('c9c9c9c9-3333-4000-8000-000000000002', 'Limits Design', true);
insert into public.companies (id, name, slug, is_active) values
  ('c9c9c9c9-3333-4000-8000-000000000003', 'Limitsco', 'limitsco', true);

-- Local helpers: the stand-in throws_ok only compares SQLSTATE, but the
-- messages ARE the contract (the app maps `limit:<kind>`), so read them.
-- The period helpers mirror the trigger's UTC keys so the counter rows
-- can be addressed.
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

create or replace function public.limits_day_key() returns text
language sql stable as $$
  select to_char(now() at time zone 'utc', 'YYYY-MM-DD')
$$;

create or replace function public.limits_month_key() returns text
language sql stable as $$
  select to_char(now() at time zone 'utc', 'YYYY-MM')
$$;

select plan(33);

-- ─── 1. Shape of the machinery ──────────────────────────────
select has_function('public', 'bump_usage_counter', 'bump_usage_counter(...) exists');
select has_function('public', 'enforce_membership_cap', 'the membership cap trigger function exists');
select has_function('public', 'admin_join_all_communities', 'the operator override RPC exists');
select is(
  (select count(*) from public.creation_limits)::integer,
  6, 'the six budgets are seeded'
);

-- ─── 2. Posts: 3 a day, threads and showcase sharing one budget ──

with ins as (
  insert into public.community_threads (community_id, user_id, title, category)
  values ('c9c9c9c9-1111-4000-8000-000000000001',
          'c9c9c9c9-0000-4000-8000-000000000001', 'Daily post 1', 'question')
  returning id
)
select ok(count(*) = 1, 'a daily post is accepted (1 of 3)') from ins;

with ins as (
  insert into public.community_threads (community_id, user_id, title, category)
  values ('c9c9c9c9-1111-4000-8000-000000000002',
          'c9c9c9c9-0000-4000-8000-000000000001', 'Daily post 2', 'question')
  returning id
)
select ok(count(*) = 1, 'a second post the same day is accepted (2 of 3)') from ins;

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
    insert into public.community_threads (community_id, user_id, title, category)
    values ('c9c9c9c9-1111-4000-8000-000000000004',
            'c9c9c9c9-0000-4000-8000-000000000001', 'Fourth post', 'question')$$),
  'limit:posts_daily',
  'the 4th post of the day is refused'
);

delete from public.community_threads
 where user_id = 'c9c9c9c9-0000-4000-8000-000000000001';

select is(
  public.limit_failure($$
    insert into public.community_threads (community_id, user_id, title, category)
    values ('c9c9c9c9-1111-4000-8000-000000000005',
            'c9c9c9c9-0000-4000-8000-000000000001', 'Repost after delete', 'question')$$),
  'limit:posts_daily',
  'deleting the posts does not refund the daily budget'
);

select is(
  (select count from public.usage_counters
    where user_id = 'c9c9c9c9-0000-4000-8000-000000000001'
      and kind = 'posts_daily' and period_key = public.limits_day_key()),
  3,
  'the counter kept every accepted post, refused bumps rolled back'
);

select set_config('app.bypass_creation_limits', 'on', false);

with ins as (
  insert into public.community_threads (community_id, user_id, title, category)
  values ('c9c9c9c9-1111-4000-8000-000000000006',
          'c9c9c9c9-0000-4000-8000-000000000001', 'Seeded post', 'question')
  returning id
)
select ok(count(*) = 1, 'the bypass flag lets fixture seeding past the budget') from ins;

select set_config('app.bypass_creation_limits', 'off', false);

select is(
  (select count from public.usage_counters
    where user_id = 'c9c9c9c9-0000-4000-8000-000000000001'
      and kind = 'posts_daily' and period_key = public.limits_day_key()),
  3,
  'bypassed inserts are not counted'
);

-- ─── 3. Events: one per month ───────────────────────────────

with ins as (
  insert into public.community_events (community_id, user_id, title, event_date)
  values ('c9c9c9c9-1111-4000-8000-000000000001',
          'c9c9c9c9-0000-4000-8000-000000000002', 'First event', now() + interval '1 day')
  returning id
)
select ok(count(*) = 1, 'the month''s first event is accepted') from ins;

select is(
  public.limit_failure($$
    insert into public.community_events (community_id, user_id, title, event_date)
    values ('c9c9c9c9-1111-4000-8000-000000000002',
            'c9c9c9c9-0000-4000-8000-000000000002', 'Second event', now() + interval '2 days')$$),
  'limit:events_monthly',
  'a second event in the same month is refused'
);

-- ─── 4. Jobs: one per month ─────────────────────────────────

with ins as (
  insert into public.job_posts
    (poster_id, company_id, kind, title, city_id, sector_id, job_title,
     experience_level, work_mode, employment_type, description)
  values
    ('c9c9c9c9-0000-4000-8000-000000000003',
     'c9c9c9c9-3333-4000-8000-000000000003', 'hiring', 'First job',
     'c9c9c9c9-3333-4000-8000-000000000001', 'c9c9c9c9-3333-4000-8000-000000000002',
     'product_designer', 'mid_level', 'remote', 'full_time', 'Design things.')
  returning id
)
select ok(count(*) = 1, 'the month''s first job post is accepted') from ins;

select is(
  public.limit_failure($$
    insert into public.job_posts
      (poster_id, company_id, kind, title, city_id, sector_id, job_title,
       experience_level, work_mode, employment_type, description)
    values
      ('c9c9c9c9-0000-4000-8000-000000000003',
       'c9c9c9c9-3333-4000-8000-000000000003', 'hiring', 'Second job',
       'c9c9c9c9-3333-4000-8000-000000000001', 'c9c9c9c9-3333-4000-8000-000000000002',
       'product_designer', 'mid_level', 'remote', 'full_time', 'Design more things.')$$),
  'limit:jobs_monthly',
  'a second job post in the same month is refused'
);

-- ─── 5. Member-created communities: one, lifetime ───────────

with ins as (
  insert into public.communities (id, name, type, owner_id, is_active)
  values ('c9c9c9c9-4444-4000-8000-000000000001', 'My Only Community', 'user',
          'c9c9c9c9-0000-4000-8000-000000000004', true)
  returning id
)
select ok(count(*) = 1, 'the member''s one community is accepted') from ins;

select is(
  public.limit_failure($$
    insert into public.communities (name, type, owner_id, is_active)
    values ('Second Community', 'user',
            'c9c9c9c9-0000-4000-8000-000000000004', true)$$),
  'limit:communities_total',
  'a second member-created community is refused'
);

delete from public.communities where id = 'c9c9c9c9-4444-4000-8000-000000000001';

select is(
  public.limit_failure($$
    insert into public.communities (name, type, owner_id, is_active)
    values ('Replacement Community', 'user',
            'c9c9c9c9-0000-4000-8000-000000000004', true)$$),
  'limit:communities_total',
  'deleting the community does not refund the lifetime budget'
);

-- ─── 6. Memberships: seven real communities, event rooms excluded ──

with ins as (
  insert into public.community_members (community_id, user_id)
  values
    ('c9c9c9c9-1111-4000-8000-000000000001', 'c9c9c9c9-0000-4000-8000-000000000005'),
    ('c9c9c9c9-1111-4000-8000-000000000002', 'c9c9c9c9-0000-4000-8000-000000000005'),
    ('c9c9c9c9-1111-4000-8000-000000000003', 'c9c9c9c9-0000-4000-8000-000000000005'),
    ('c9c9c9c9-1111-4000-8000-000000000004', 'c9c9c9c9-0000-4000-8000-000000000005'),
    ('c9c9c9c9-1111-4000-8000-000000000005', 'c9c9c9c9-0000-4000-8000-000000000005'),
    ('c9c9c9c9-1111-4000-8000-000000000006', 'c9c9c9c9-0000-4000-8000-000000000005'),
    ('c9c9c9c9-1111-4000-8000-000000000007', 'c9c9c9c9-0000-4000-8000-000000000005')
  returning community_id
)
select ok(count(*) = 7, 'seven communities join fine') from ins;

select is(
  public.limit_failure($$
    insert into public.community_members (community_id, user_id)
    values ('c9c9c9c9-1111-4000-8000-000000000008',
            'c9c9c9c9-0000-4000-8000-000000000005')$$),
  'limit:community_joins',
  'the 8th community is refused'
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
  values ('c9c9c9c9-1111-4000-8000-000000000008',
          'c9c9c9c9-0000-4000-8000-000000000005')
  returning community_id
)
select ok(count(*) = 1, 'leaving a community frees its slot') from ins;

select is(
  public.limit_failure($$
    insert into public.community_members (community_id, user_id)
    values ('c9c9c9c9-1111-4000-8000-000000000009',
            'c9c9c9c9-0000-4000-8000-000000000005')$$),
  'limit:community_joins',
  'the cap re-engages at seven'
);

-- ─── 7. DMs: five NEW conversations a month ─────────────────

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

-- ─── 8. The operator override ───────────────────────────────

select ok(
  public.admin_join_all_communities('c9c9c9c9-0000-4000-8000-000000000005') > 7,
  'the admin override joins past the seven-community cap'
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
