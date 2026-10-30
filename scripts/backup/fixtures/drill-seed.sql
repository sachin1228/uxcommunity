-- Seed data for the restore drill.
--
-- Every row uses a fixed UUID so a restore can be compared row-for-row, and
-- every insert is idempotent (`on conflict do nothing`) so re-running the drill
-- against a kept cluster does not fail. The shape mirrors what production
-- actually holds: users, communities, memberships, chat, companies, jobs,
-- applications and direct messages — the tables the audit's recovery matrix
-- promises to bring back.

insert into public.users (id, name, email, password_hash) values
  ('11111111-1111-1111-1111-111111111111', 'Drill Viewer',  'drill-viewer@example.test',  'x'),
  ('22222222-2222-2222-2222-222222222222', 'Drill Author',  'drill-author@example.test',  'x'),
  ('33333333-3333-3333-3333-333333333333', 'Drill Poster',  'drill-poster@example.test',  'x')
on conflict (id) do nothing;

insert into public.communities (id, name, type, is_active) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', 'Drill Community A', 'city', true),
  ('bbbbbbbb-0000-0000-0000-00000000000b', 'Drill Community B', 'city', true)
on conflict (id) do nothing;

insert into public.community_members (community_id, user_id, joined_at) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', now() - interval '30 days'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', now() - interval '29 days'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', '33333333-3333-3333-3333-333333333333', now() - interval '10 days')
on conflict (community_id, user_id) do nothing;

insert into public.community_messages (community_id, user_id, content, created_at) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', '11111111-1111-1111-1111-111111111111', 'Drill: first message', now() - interval '2 days'),
  ('aaaaaaaa-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222', 'Drill: reply message', now() - interval '1 day'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', '33333333-3333-3333-3333-333333333333', 'Drill: other community', now() - interval '3 hours');

-- Volume, so the dump is not a handful of rows and the restore exercises a
-- sequential scan rather than a single page.
insert into public.community_messages (community_id, user_id, content, created_at)
select
  'aaaaaaaa-0000-0000-0000-00000000000a',
  '22222222-2222-2222-2222-222222222222',
  'Drill: generated message ' || n,
  now() - (n || ' minutes')::interval
from generate_series(1, 40) as n;

insert into public.cities (id, name) values
  ('dddddddd-0000-0000-0000-0000000000d1', 'Drill City')
on conflict do nothing;

insert into public.design_sectors (id, name) values
  ('eeeeeeee-0000-0000-0000-0000000000e1', 'Drill Sector')
on conflict do nothing;

insert into public.companies (id, name, slug) values
  ('cccccccc-0000-0000-0000-0000000000c1', 'Drill Company', 'drill-company')
on conflict do nothing;

insert into public.job_titles (slug, name) values
  ('drill-product-designer', 'Drill Product Designer')
on conflict (slug) do nothing;

insert into public.job_posts (
  id, poster_id, company_id, kind, title, city_id, sector_id,
  job_title, experience_level, work_mode, employment_type, description
) values (
  'ffffffff-0000-0000-0000-0000000000f1',
  '33333333-3333-3333-3333-333333333333',
  'cccccccc-0000-0000-0000-0000000000c1',
  'hiring',
  'Drill Product Designer',
  'dddddddd-0000-0000-0000-0000000000d1',
  'eeeeeeee-0000-0000-0000-0000000000e1',
  'drill-product-designer',
  'mid_level',
  'remote',
  'full_time',
  'A job posting created by the restore drill to prove jobs and applications survive a backup.'
)
on conflict (id) do nothing;

insert into public.job_applications (id, job_id, applicant_id, name, portfolio_url, linkedin_url) values
  ('aaaaaaaa-1111-1111-1111-111111111111', 'ffffffff-0000-0000-0000-0000000000f1', '11111111-1111-1111-1111-111111111111',
   'Drill Viewer', 'https://example.test/portfolio', 'https://example.test/linkedin')
on conflict (id) do nothing;

insert into public.dm_conversations (id, user_a, user_b, last_message_at) values
  ('bbbbbbbb-1111-1111-1111-111111111111',
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222',
   now() - interval '1 hour')
on conflict (id) do nothing;

insert into public.dm_messages (id, conversation_id, user_id, content, created_at) values
  ('cccccccc-1111-1111-1111-111111111111',
   'bbbbbbbb-1111-1111-1111-111111111111',
   '11111111-1111-1111-1111-111111111111',
   'Drill: direct message body',
   now() - interval '1 hour')
on conflict (id) do nothing;
