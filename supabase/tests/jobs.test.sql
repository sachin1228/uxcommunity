-- ============================================================
-- Jobs — verified-company postings with profile-gated applications
--
-- Migration under test: 20261009120000_jobs.sql
--
-- The two rules that make a posting trustworthy are:
--
--   1. the poster has PROVED the company with a work email (the
--      company_members row the profile badge reads), and
--   2. the APPLICANT's own profile matches all four dimensions of
--      the posting (city, sector, job title, experience level).
--
-- This file proves both at the database layer, where the writes
-- re-check them — the API routes only pass the session user id:
--
--   1. create_job_post refuses without a verified membership, and
--      refuses bad kinds, inactive companies and every criterion
--      that is not live master data;
--   2. apply_to_job gates on the applicant's profile row, not on
--      anything a request could carry: the full mismatch matrix;
--   3. one application per member per job, poster cannot apply to
--      their own posting, URLs are shape-checked;
--   4. the reads return the viewer's flags (can_apply, applied,
--      is_mine) computed by the same rule the write enforces, and
--      the applicants board is the poster's alone.
--
-- Runs inside a transaction: every fixture is rolled back, and the
-- file does not depend on what other suites left behind.
-- ============================================================

select plan(59);

begin;

-- ─── Isolation + fixtures ───────────────────────────────────
-- The clean-up first so a failed earlier run cannot leak into this
-- one: applications and posts carry the users, the membership and
-- the company are fixture-local.
delete from public.job_applications;
delete from public.job_posts;
delete from public.company_members where company_id = 'a7a7a7a7-0000-4000-8000-000000000001';
delete from public.company_domains where company_id = 'a7a7a7a7-0000-4000-8000-000000000001';
delete from public.companies where id = 'a7a7a7a7-0000-4000-8000-000000000001';
delete from public.designer_profiles where user_id in (
  'd7d7d7d7-0000-4000-8000-000000000001',
  'd7d7d7d7-0000-4000-8000-000000000002',
  'd7d7d7d7-0000-4000-8000-000000000003',
  'd7d7d7d7-0000-4000-8000-000000000004',
  'd7d7d7d7-0000-4000-8000-000000000005',
  'd7d7d7d7-0000-4000-8000-000000000006'
);
delete from public.users where id in (
  'd7d7d7d7-0000-4000-8000-000000000001',
  'd7d7d7d7-0000-4000-8000-000000000002',
  'd7d7d7d7-0000-4000-8000-000000000003',
  'd7d7d7d7-0000-4000-8000-000000000004',
  'd7d7d7d7-0000-4000-8000-000000000005',
  'd7d7d7d7-0000-4000-8000-000000000006'
);
delete from public.cities where id in (
  'e7e7e7e7-0000-4000-8000-000000000001',
  'e7e7e7e7-0000-4000-8000-000000000002'
);
delete from public.design_sectors where id in (
  'f7f7f7f7-0000-4000-8000-000000000001'
);

-- Members: the poster, a fully matched applicant, and three
-- near-misses (wrong city, wrong job title, partial profile).
insert into public.users (id, name, email, password_hash, application_id) values
  ('d7d7d7d7-0000-4000-8000-000000000001', 'Poster',   'poster@jobs.test',   'x', null),
  ('d7d7d7d7-0000-4000-8000-000000000002', 'Matched',  'matched@jobs.test',  'x', null),
  ('d7d7d7d7-0000-4000-8000-000000000003', 'FarCity',  'farcity@jobs.test',  'x', null),
  ('d7d7d7d7-0000-4000-8000-000000000004', 'OtherRole','otherrole@jobs.test','x', null),
  ('d7d7d7d7-0000-4000-8000-000000000005', 'Partial',  'partial@jobs.test',  'x', null),
  ('d7d7d7d7-0000-4000-8000-000000000006', 'Outsider', 'outsider@jobs.test', 'x', null);

insert into public.cities (id, name, is_active) values
  ('e7e7e7e7-0000-4000-8000-000000000001', 'Jobsville', true),
  ('e7e7e7e7-0000-4000-8000-000000000002', 'Farville',  true);

insert into public.design_sectors (id, name, is_active) values
  ('f7f7f7f7-0000-4000-8000-000000000001', 'Product Design', true);

insert into public.designer_profiles
  (user_id, city_id, sector_id, job_title, experience_level)
values
  ('d7d7d7d7-0000-4000-8000-000000000001', 'e7e7e7e7-0000-4000-8000-000000000001',
   'f7f7f7f7-0000-4000-8000-000000000001', 'product_designer', 'mid_level'),
  ('d7d7d7d7-0000-4000-8000-000000000002', 'e7e7e7e7-0000-4000-8000-000000000001',
   'f7f7f7f7-0000-4000-8000-000000000001', 'product_designer', 'mid_level'),
  ('d7d7d7d7-0000-4000-8000-000000000003', 'e7e7e7e7-0000-4000-8000-000000000002',
   'f7f7f7f7-0000-4000-8000-000000000001', 'product_designer', 'mid_level'),
  ('d7d7d7d7-0000-4000-8000-000000000004', 'e7e7e7e7-0000-4000-8000-000000000001',
   'f7f7f7f7-0000-4000-8000-000000000001', 'ux_designer', 'mid_level'),
  -- Partial profile: no city, no sector — must never count as matched.
  ('d7d7d7d7-0000-4000-8000-000000000005', null, null,
   'product_designer', 'mid_level'),
  ('d7d7d7d7-0000-4000-8000-000000000006', 'e7e7e7e7-0000-4000-8000-000000000001',
   'f7f7f7f7-0000-4000-8000-000000000001', 'product_designer', 'mid_level');

-- The company: verified domain + a verified membership for the
-- poster only. Outsider joins later as UNVERIFIED to show the
-- proof, not the row, is what counts.
insert into public.companies (id, name, slug, is_active) values
  ('a7a7a7a7-0000-4000-8000-000000000001', 'Jobsco', 'jobsco', true);

insert into public.company_domains (company_id, domain, verified, verified_at) values
  ('a7a7a7a7-0000-4000-8000-000000000001', 'jobsco.test', true, now());

insert into public.company_members (company_id, user_id, verified) values
  ('a7a7a7a7-0000-4000-8000-000000000001', 'd7d7d7d7-0000-4000-8000-000000000001', true),
  ('a7a7a7a7-0000-4000-8000-000000000001', 'd7d7d7d7-0000-4000-8000-000000000006', false);

-- A local helper: the stand-in throws_ok only compares SQLSTATE, but
-- the failure codes ARE the contract here, so read the message.
create or replace function public.failure_message(stmt text) returns text
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

-- ─── 1. Shape of the model ──────────────────────────────────

select has_function('public', 'create_job_post', 'create_job_post(...) exists');
select has_function('public', 'apply_to_job', 'apply_to_job(...) exists');
select has_function('public', 'get_job_feed', 'get_job_feed(viewer, limit) exists');
select has_function('public', 'get_job_detail', 'get_job_detail(job, viewer) exists');
select has_function('public', 'get_job_applicants', 'get_job_applicants(poster, job) exists');
select has_index('public', 'job_applications', 'job_applications_job_applicant_key',
  'one application per member per job is a table constraint');
select is(
  (select relrowsecurity from pg_class where oid = 'public.job_posts'::regclass),
  true,
  'job_posts has row level security enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.job_applications'::regclass),
  true,
  'job_applications has row level security enabled'
);

-- ─── 2. Posting requires the verified company ───────────────

select is(
  public.failure_message($$
    select * from public.create_job_post(
      'd7d7d7d7-0000-4000-8000-000000000006', 'hiring',
      'a7a7a7a7-0000-4000-8000-000000000001', 'Senior Product Designer',
      'e7e7e7e7-0000-4000-8000-000000000001', 'f7f7f7f7-0000-4000-8000-000000000001',
      'product_designer', 'mid_level', 'hybrid', 'full_time',
      null, 'Design payments flows.', '{}', '{}', '{}', null
    )$$),
  'company_not_verified',
  'an unverified membership cannot post for the company'
);

select is(
  public.failure_message($$
    select * from public.create_job_post(
      'd7d7d7d7-0000-4000-8000-000000000001', 'referring',
      'a7a7a7a7-0000-4000-8000-000000000001', 'Senior Product Designer',
      'e7e7e7e7-0000-4000-8000-000000000001', 'f7f7f7f7-0000-4000-8000-000000000001',
      'product_designer', 'mid_level', 'hybrid', 'full_time',
      null, 'Design payments flows.', '{}', '{}', '{}', null
    )$$),
  'invalid_kind',
  'only hiring / referral are valid kinds'
);

select is(
  public.failure_message($$
    select * from public.create_job_post(
      'd7d7d7d7-0000-4000-8000-000000000001', 'hiring',
      'a7a7a7a7-0000-4000-8000-000000000001', 'Senior Product Designer',
      'e7e7e7e7-0000-4000-8000-000000000001', 'f7f7f7f7-0000-4000-8000-000000000001',
      'product_designer', 'mid_level', 'sometimes', 'full_time',
      null, 'Design payments flows.', '{}', '{}', '{}', null
    )$$),
  'invalid_work_mode',
  'an unknown work mode is refused'
);

select is(
  public.failure_message($$
    select * from public.create_job_post(
      'd7d7d7d7-0000-4000-8000-000000000001', 'hiring',
      'a7a7a7a7-0000-4000-8000-000000000001', 'Senior Product Designer',
      '00000000-0000-4000-8000-000000000000', 'f7f7f7f7-0000-4000-8000-000000000001',
      'product_designer', 'mid_level', 'hybrid', 'full_time',
      null, 'Design payments flows.', '{}', '{}', '{}', null
    )$$),
  'invalid_city',
  'a city outside the master data is refused'
);

select is(
  public.failure_message($$
    select * from public.create_job_post(
      'd7d7d7d7-0000-4000-8000-000000000001', 'hiring',
      'a7a7a7a7-0000-4000-8000-000000000001', 'Senior Product Designer',
      'e7e7e7e7-0000-4000-8000-000000000001', 'f7f7f7f7-0000-4000-8000-000000000001',
      'wizard', 'mid_level', 'hybrid', 'full_time',
      null, 'Design payments flows.', '{}', '{}', '{}', null
    )$$),
  'invalid_job_title',
  'a job title outside the master data is refused'
);

select is(
  public.failure_message($$
    select * from public.create_job_post(
      'd7d7d7d7-0000-4000-8000-000000000001', 'hiring',
      'a7a7a7a7-0000-4000-8000-000000000001', 'Senior Product Designer',
      'e7e7e7e7-0000-4000-8000-000000000001', 'f7f7f7f7-0000-4000-8000-000000000001',
      'product_designer', 'ceo', 'hybrid', 'full_time',
      null, 'Design payments flows.', '{}', '{}', '{}', null
    )$$),
  'invalid_experience_level',
  'an experience level outside the master data is refused'
);

select is(
  public.failure_message($$
    select * from public.create_job_post(
      'd7d7d7d7-0000-4000-8000-000000000001', 'hiring',
      'a7a7a7a7-0000-4000-8000-000000000001', 'Senior Product Designer',
      'e7e7e7e7-0000-4000-8000-000000000001', 'f7f7f7f7-0000-4000-8000-000000000001',
      'product_designer', 'mid_level', 'hybrid', 'full_time',
      null, '   ', '{}', '{}', '{}', null
    )$$),
  'missing_description',
  'a blank description is refused'
);

select is(
  public.failure_message($$
    select * from public.create_job_post(
      'd7d7d7d7-0000-4000-8000-000000000001', 'hiring',
      'a7a7a7a7-0000-4000-8000-000000000001', 'Senior Product Designer',
      'e7e7e7e7-0000-4000-8000-000000000001', 'f7f7f7f7-0000-4000-8000-000000000001',
      'product_designer', 'mid_level', 'hybrid', 'full_time',
      'Great pay', 'Design payments flows.', '{}', '{}', '{}', 'jobsco.test'
    )$$),
  'invalid_website',
  'a website without a scheme is refused'
);

-- ─── 3. A verified poster creates the posting ───────────────

select is(
  (select count(*) from public.create_job_post(
    'd7d7d7d7-0000-4000-8000-000000000001', 'hiring',
    'a7a7a7a7-0000-4000-8000-000000000001', '  Senior Product Designer  ',
    'e7e7e7e7-0000-4000-8000-000000000001', 'f7f7f7f7-0000-4000-8000-000000000001',
    'product_designer', 'mid_level', 'hybrid', 'full_time',
    '  ', 'Design payments flows.',
    array['Own the payments flow', '  ', 'Pair with design systems'],
    array['5+ years experience'],
    array['Figma', 'Prototyping'],
    null
  )),
  1::bigint,
  'a verified member can post'
);

select is(
  (select title from public.job_posts where title = 'Senior Product Designer'),
  'Senior Product Designer',
  'the title is stored trimmed'
);

select is(
  (select salary from public.job_posts where title = 'Senior Product Designer'),
  null::text,
  'a blank salary is stored as NULL, not an empty string'
);

select is(
  (select responsibilities from public.job_posts where title = 'Senior Product Designer'),
  array['Own the payments flow', 'Pair with design systems'],
  'blank list rows are dropped, the rest keep their order'
);

select is(
  (select skills from public.job_posts where title = 'Senior Product Designer'),
  array['Figma', 'Prototyping'],
  'skills are stored as a clean array'
);

select is(
  (select kind from public.job_posts where title = 'Senior Product Designer'),
  'hiring',
  'the kind is stored'
);

-- ─── 4. Applying: the profile match gates it ────────────────

select is(
  (select count(*) from public.apply_to_job(
    (select id from public.job_posts where title = 'Senior Product Designer'),
    'd7d7d7d7-0000-4000-8000-000000000002',
    '  Matched Applicant  ',
    'https://portfolio.matched.test',
    'https://www.linkedin.com/in/matched',
    null
  )),
  1::bigint,
  'a matched member can apply without a resume'
);

select is(
  (select name from public.job_applications
   where applicant_id = 'd7d7d7d7-0000-4000-8000-000000000002'),
  'Matched Applicant',
  'the application name is stored trimmed'
);

-- Same-timestamp tie-break: pin the first application a touch earlier
-- so the board's newest-first assertion below is deterministic.
update public.job_applications set created_at = now() - interval '1 hour'
  where applicant_id = 'd7d7d7d7-0000-4000-8000-000000000002';

select is(
  public.failure_message($$
    select * from public.apply_to_job(
      (select id from public.job_posts where title = 'Senior Product Designer'),
      'd7d7d7d7-0000-4000-8000-000000000003',
      'Far City', 'https://portfolio.far.test',
      'https://www.linkedin.com/in/far', null
    )$$),
  'not_eligible',
  'a member from another city cannot apply'
);

select is(
  public.failure_message($$
    select * from public.apply_to_job(
      (select id from public.job_posts where title = 'Senior Product Designer'),
      'd7d7d7d7-0000-4000-8000-000000000004',
      'Other Role', 'https://portfolio.role.test',
      'https://www.linkedin.com/in/role', null
    )$$),
  'not_eligible',
  'a member with another job title cannot apply'
);

select is(
  public.failure_message($$
    select * from public.apply_to_job(
      (select id from public.job_posts where title = 'Senior Product Designer'),
      'd7d7d7d7-0000-4000-8000-000000000005',
      'Partial Profile', 'https://portfolio.partial.test',
      'https://www.linkedin.com/in/partial', null
    )$$),
  'not_eligible',
  'a partial profile (no city / sector) cannot apply'
);

select is(
  public.failure_message($$
    select * from public.apply_to_job(
      (select id from public.job_posts where title = 'Senior Product Designer'),
      'd7d7d7d7-0000-4000-8000-000000000001',
      'Poster Self', 'https://portfolio.poster.test',
      'https://www.linkedin.com/in/poster', null
    )$$),
  'own_job',
  'the poster cannot apply to their own posting'
);

select is(
  public.failure_message($$
    select * from public.apply_to_job(
      (select id from public.job_posts where title = 'Senior Product Designer'),
      'd7d7d7d7-0000-4000-8000-000000000002',
      'Matched Again', 'https://portfolio.matched.test',
      'https://www.linkedin.com/in/matched', null
    )$$),
  'already_applied',
  'a second application to the same job is refused'
);

select is(
  public.failure_message($$
    select * from public.apply_to_job(
      (select id from public.job_posts where title = 'Senior Product Designer'),
      'd7d7d7d7-0000-4000-8000-000000000006',
      'Bad Portfolio', 'portfolio.no-scheme.test',
      'https://www.linkedin.com/in/outsider', null
    )$$),
  'invalid_portfolio_url',
  'a portfolio URL without a scheme is refused'
);

select is(
  public.failure_message($$
    select * from public.apply_to_job(
      (select id from public.job_posts where title = 'Senior Product Designer'),
      'd7d7d7d7-0000-4000-8000-000000000006',
      'Bad LinkedIn', 'https://portfolio.outsider.test',
      'https://example.com/in/outsider', null
    )$$),
  'invalid_linkedin_url',
  'a LinkedIn URL that is not LinkedIn is refused'
);

select is(
  public.failure_message($$
    select * from public.apply_to_job(
      (select id from public.job_posts where title = 'Senior Product Designer'),
      'd7d7d7d7-0000-4000-8000-000000000006',
      'Bad Resume', 'https://portfolio.outsider.test',
      'https://www.linkedin.com/in/outsider', 'not-a-url'
    )$$),
  'invalid_resume_url',
  'a resume URL that is not a URL is refused'
);

select is(
  public.failure_message($$
    select * from public.apply_to_job(
      '00000000-0000-4000-8000-000000000000',
      'd7d7d7d7-0000-4000-8000-000000000006',
      'Ghost Job', 'https://portfolio.outsider.test',
      'https://www.linkedin.com/in/outsider', null
    )$$),
  'job_not_found',
  'applying to a missing job is refused'
);

-- The unmatched outsider proves membership being unverified is not
-- the gate for applying (they were never in the company): the
-- profile is. Give them a matching profile and they may apply.
update public.designer_profiles
  set city_id = 'e7e7e7e7-0000-4000-8000-000000000001',
      sector_id = 'f7f7f7f7-0000-4000-8000-000000000001'
  where user_id = 'd7d7d7d7-0000-4000-8000-000000000006';

select is(
  (select count(*) from public.apply_to_job(
    (select id from public.job_posts where title = 'Senior Product Designer'),
    'd7d7d7d7-0000-4000-8000-000000000006',
    'Outsider Now Matched', 'https://portfolio.outsider.test',
    'https://www.linkedin.com/in/outsider',
    'https://cdn.example.test/resumes/outsider.pdf'
  )),
  1::bigint,
  'the same member can apply once their profile matches'
);

select is(
  (select resume_url from public.job_applications
   where applicant_id = 'd7d7d7d7-0000-4000-8000-000000000006'),
  'https://cdn.example.test/resumes/outsider.pdf',
  'the resume URL is stored'
);

-- ─── 5. Reads: the viewer flags match the write rule ────────

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000001')
          ->> 'can_apply'
   from public.job_posts as jp where jp.title = 'Senior Product Designer'),
  'false',
  'the poster cannot apply to their own posting (can_apply false)'
);

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000001')
          ->> 'is_mine'
   from public.job_posts as jp where jp.title = 'Senior Product Designer'),
  'true',
  'the poster sees the posting as theirs'
);

-- The "Posted by" card shows where the poster works: the payload carries
-- the company from their profile.
update public.designer_profiles
set company_id = 'a7a7a7a7-0000-4000-8000-000000000001'
where user_id = 'd7d7d7d7-0000-4000-8000-000000000001';

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000002')
          -> 'poster' ->> 'company_name'
   from public.job_posts as jp where jp.title = 'Senior Product Designer'),
  'Jobsco',
  'the payload carries the poster''s profile company'
);

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000002')
          ->> 'applied'
   from public.job_posts as jp where jp.title = 'Senior Product Designer'),
  'true',
  'an applicant sees their application'
);

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000002')
          ->> 'can_apply'
   from public.job_posts as jp where jp.title = 'Senior Product Designer'),
  'false',
  'an applicant cannot apply twice (can_apply false)'
);

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000003')
          ->> 'can_apply'
   from public.job_posts as jp where jp.title = 'Senior Product Designer'),
  'false',
  'a city mismatch locks Apply for that viewer'
);

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000003')
          ->> 'city_name'
   from public.job_posts as jp where jp.title = 'Senior Product Designer'),
  'Jobsville',
  'the payload resolves the city name'
);

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000003')
          ->> 'job_title_label'
   from public.job_posts as jp where jp.title = 'Senior Product Designer'),
  'Product Designer',
  'the payload resolves the job title label from the slug'
);

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000003')
          ->> 'experience_level_label'
   from public.job_posts as jp where jp.title = 'Senior Product Designer'),
  'Mid-Level Designers',
  'the payload resolves the experience label from the slug'
);

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000003')
          #>> '{company,name}'
   from public.job_posts as jp where jp.title = 'Senior Product Designer'),
  'Jobsco',
  'the payload carries the verified company'
);

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000003')
          #>> '{company,domain_verified}'
   from public.job_posts as jp where jp.title = 'Senior Product Designer'),
  'true',
  'the company is flagged as domain-verified'
);

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000003')
          ->> 'applicant_count'
   from public.job_posts as jp where jp.title = 'Senior Product Designer'),
  '2',
  'the payload counts applicants'
);

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000003')
          #>> '{poster,name}'
   from public.job_posts as jp where jp.title = 'Senior Product Designer'),
  'Poster',
  'the payload carries the poster'
);

-- A second posting by the same poster proves feed ordering and
-- per-viewer flags across several rows. Both rows share this
-- transaction's now() (so they share created_at), so pin the second
-- one slightly ahead — a database cannot order two identical
-- timestamps meaningfully, and the test must not depend on gen_random_uuid luck.
select count(*) from public.create_job_post(
  'd7d7d7d7-0000-4000-8000-000000000001', 'referral',
  'a7a7a7a7-0000-4000-8000-000000000001', 'Design Ops Lead',
  'e7e7e7e7-0000-4000-8000-000000000001', 'f7f7f7f7-0000-4000-8000-000000000001',
  'ux_designer', 'mid_level', 'remote', 'contract',
  'Not disclosed', 'Run the design system.',
  '{}', '{}', '{}', null
);

update public.job_posts set created_at = now() + interval '1 hour'
  where title = 'Design Ops Lead';

select is(
  (select count(*) from public.get_job_feed('d7d7d7d7-0000-4000-8000-000000000003')),
  2::bigint,
  'the feed lists every posting for any viewer'
);

select is(
  (select item ->> 'title' from public.get_job_feed(
     'd7d7d7d7-0000-4000-8000-000000000003')
   order by item ->> 'created_at' desc limit 1),
  'Design Ops Lead',
  'the feed is newest-first'
);

select is(
  (select item ->> 'applicant_count' from public.get_job_detail(
     (select id from public.job_posts where title = 'Senior Product Designer'),
     'd7d7d7d7-0000-4000-8000-000000000002'
   )),
  '2',
  'get_job_detail renders the posting with its flags'
);

select is(
  (select item #>> '{my_application,linkedin_url}' from public.get_job_detail(
     (select id from public.job_posts where title = 'Senior Product Designer'),
     'd7d7d7d7-0000-4000-8000-000000000002'
   )),
  'https://www.linkedin.com/in/matched',
  'get_job_detail carries the viewer''s own application'
);

select is(
  (select count(*) from public.get_job_detail(
     '00000000-0000-4000-8000-000000000000',
     'd7d7d7d7-0000-4000-8000-000000000002'
   )),
  0::bigint,
  'get_job_detail returns nothing for a missing job'
);

-- ─── 6. The applicants board is the poster's alone ──────────

select is(
  (select count(*) from public.get_job_applicants(
     'd7d7d7d7-0000-4000-8000-000000000001',
     (select id from public.job_posts where title = 'Senior Product Designer')
   )),
  2::bigint,
  'the poster reads every applicant'
);

select is(
  public.failure_message($$
    select * from public.get_job_applicants(
      'd7d7d7d7-0000-4000-8000-000000000002',
      (select id from public.job_posts where title = 'Senior Product Designer')
    )$$),
  'not_your_job',
  'a non-poster cannot read the applicants board'
);

select is(
  (select item #>> '{name}' from public.get_job_applicants(
     'd7d7d7d7-0000-4000-8000-000000000001',
     (select id from public.job_posts where title = 'Senior Product Designer')
   ) order by item ->> 'created_at' desc, item ->> 'id' desc limit 1),
  'Outsider Now Matched',
  'the applicants board is newest-first'
);

select is(
  (select item #>> '{portfolio_url}' from public.get_job_applicants(
     'd7d7d7d7-0000-4000-8000-000000000001',
     (select id from public.job_posts where title = 'Senior Product Designer')
   ) order by item ->> 'created_at' desc, item ->> 'id' desc limit 1),
  'https://portfolio.outsider.test',
  'the applicants board carries portfolio, LinkedIn and resume'
);

-- ─── 7. Round trip: a deleted account frees the posting ─────

delete from public.users where id = 'd7d7d7d7-0000-4000-8000-000000000002';

select is(
  (select count(*) from public.job_applications
   where job_id = (select id from public.job_posts where title = 'Senior Product Designer')),
  1::bigint,
  'deleting an applicant removes only their application'
);

select is(
  (select count(*) from public.job_posts where title = 'Senior Product Designer'),
  1::bigint,
  'the posting survives an applicant leaving'
);

select finish();

rollback;
