-- ============================================================
-- Jobs — verified-company postings with profile-gated applications
--
-- Migrations under test: 20261009120000_jobs.sql,
-- 20261009170000_job_lifecycle.sql and 20261009180000_job_expiry.sql
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
--      the applicants board is the poster's alone;
--   5. the lifecycle: only the poster may edit, close or delete; a
--      posting's four targeting criteria freeze the moment an
--      application exists (while the rest of it stays editable);
--      a closed posting leaves the browse feed but stays readable
--      by its owner, refuses applications, and reopens cleanly;
--      deleting takes the applications with it;
--   6. the closing date: one expression (job_post_is_open) decides
--      whether a posting takes applications, an expired posting
--      leaves the browse feed while keeping its owner's view,
--      applying to one is refused as expired rather than closed, and
--      reopening clears a deadline that has already passed.
--
-- Runs inside a transaction: every fixture is rolled back, and the
-- file does not depend on what other suites left behind.
-- ============================================================

select plan(123);

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
  'd7d7d7d7-0000-4000-8000-000000000006',
  'd7d7d7d7-0000-4000-8000-000000000007'
);
delete from public.users where id in (
  'd7d7d7d7-0000-4000-8000-000000000001',
  'd7d7d7d7-0000-4000-8000-000000000002',
  'd7d7d7d7-0000-4000-8000-000000000003',
  'd7d7d7d7-0000-4000-8000-000000000004',
  'd7d7d7d7-0000-4000-8000-000000000005',
  'd7d7d7d7-0000-4000-8000-000000000006',
  'd7d7d7d7-0000-4000-8000-000000000007'
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
  ('d7d7d7d7-0000-4000-8000-000000000006', 'Outsider', 'outsider@jobs.test', 'x', null),
  -- Matches the lifecycle section's posting and never applies until the
  -- reopen test, so "Apply is available" and "Apply is closed" are both
  -- assertions about the posting rather than about a stray application.
  ('d7d7d7d7-0000-4000-8000-000000000007', 'Opener',   'opener@jobs.test',   'x', null);

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
   'f7f7f7f7-0000-4000-8000-000000000001', 'product_designer', 'mid_level'),
  -- Matches the referral posting's ux_designer / mid_level criteria.
  ('d7d7d7d7-0000-4000-8000-000000000007', 'e7e7e7e7-0000-4000-8000-000000000001',
   'f7f7f7f7-0000-4000-8000-000000000001', 'ux_designer', 'mid_level');

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

-- ─── 6b. Triaging applicants (new / shortlisted / rejected) ─
-- The triage migration (20261010120000_job_application_triage.sql): one
-- column, one poster-only write. A decision is a standing, not a log —
-- it moves in any direction and carries no timestamp of its own.

select has_function(
  'public', 'set_job_application_status',
  'set_job_application_status(actor, application, status) exists'
);

select is(
  (select application_status from public.set_job_application_status(
     'd7d7d7d7-0000-4000-8000-000000000001',
     (select id from public.job_applications
      where applicant_id = 'd7d7d7d7-0000-4000-8000-000000000006'),
     'shortlisted'
   )),
  'shortlisted',
  'the poster shortlists an applicant'
);

select is(
  (select item ->> 'status' from public.get_job_applicants(
     'd7d7d7d7-0000-4000-8000-000000000001',
     (select id from public.job_posts where title = 'Senior Product Designer')
   ) where item ->> 'name' = 'Outsider Now Matched'),
  'shortlisted',
  'the applicants board carries the decision it stored'
);

select is(
  (select item ->> 'status' from public.get_job_applicants(
     'd7d7d7d7-0000-4000-8000-000000000001',
     (select id from public.job_posts where title = 'Senior Product Designer')
   ) where item ->> 'name' = 'Matched Applicant'),
  'new',
  'an untouched application reads as new'
);

select is(
  public.failure_message($$
    select * from public.set_job_application_status(
      'd7d7d7d7-0000-4000-8000-000000000003',
      (select id from public.job_applications
       where applicant_id = 'd7d7d7d7-0000-4000-8000-000000000006'),
      'rejected'
    )$$),
  'not_your_job',
  'only the posting''s owner may triage its applicants'
);

select is(
  public.failure_message($$
    select * from public.set_job_application_status(
      'd7d7d7d7-0000-4000-8000-000000000001',
      (select id from public.job_applications
       where applicant_id = 'd7d7d7d7-0000-4000-8000-000000000006'),
      'hired'
    )$$),
  'invalid_status',
  'a status outside the three is refused'
);

select is(
  public.failure_message($$
    select * from public.set_job_application_status(
      'd7d7d7d7-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000000',
      'rejected'
    )$$),
  'application_not_found',
  'triaging a missing application is refused'
);

select is(
  (select application_status from public.set_job_application_status(
     'd7d7d7d7-0000-4000-8000-000000000001',
     (select id from public.job_applications
      where applicant_id = 'd7d7d7d7-0000-4000-8000-000000000006'),
     'new'
   )),
  'new',
  'a decision moves back to new'
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

-- ─── 8. The owner's edit ─────────────────────────────────────
-- The lifecycle migration (20261009170000_job_lifecycle.sql): one write for
-- editing, one for closing/reopening, one for deleting, and the rule that
-- makes the first of those safe — the four targeting criteria freeze once an
-- application exists, because they are what `apply_to_job` compares against a
-- member's profile.

select has_function('public', 'update_job_post', 'update_job_post(...) exists');
select has_function('public', 'set_job_post_status', 'set_job_post_status(...) exists');
select has_function('public', 'delete_job_post', 'delete_job_post(...) exists');

select is(
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'job_posts'
     and column_name = 'status' and is_nullable = 'NO'),
  1::bigint,
  'job_posts carries a non-null lifecycle status'
);

select is(
  (select count(*) from public.job_posts where updated_at is null),
  2::bigint,
  'a posting carries no edit stamp until it is edited'
);

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000003')
          ->> 'status'
   from public.job_posts as jp where jp.title = 'Design Ops Lead'),
  'open',
  'the payload carries the lifecycle status'
);

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000003')
          ->> 'criteria_locked'
   from public.job_posts as jp where jp.title = 'Design Ops Lead'),
  'false',
  'the payload reports the criteria as free while nobody has applied'
);

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000003')
          ->> 'criteria_locked'
   from public.job_posts as jp where jp.title = 'Senior Product Designer'),
  'true',
  'the payload locks the criteria as soon as an applicant exists'
);

-- The referral posting has no applicants, so its criteria are still free.
select is(
  (select edited_at is not null from public.update_job_post(
     p_actor_id         => 'd7d7d7d7-0000-4000-8000-000000000001',
     p_job_id           => (select id from public.job_posts where title = 'Design Ops Lead'),
     p_title            => 'Design Ops Lead',
     p_city_id          => 'e7e7e7e7-0000-4000-8000-000000000002',
     p_sector_id        => 'f7f7f7f7-0000-4000-8000-000000000001',
     p_job_title        => 'ux_designer',
     p_experience_level => 'mid_level',
     p_work_mode        => 'remote',
     p_employment_type  => 'contract',
     p_salary           => 'Not disclosed',
     p_description      => 'Run the design system.'
  )),
  true,
  'the owner can edit a posting nobody has applied to, stamp and all'
);

select is(
  (select city_id from public.job_posts where title = 'Design Ops Lead'),
  'e7e7e7e7-0000-4000-8000-000000000002'::uuid,
  'the targeting criteria may move while nobody has applied'
);

-- Back to the original city, so everything after this reads the fixture it
-- expects.
select count(*) from public.update_job_post(
  p_actor_id         => 'd7d7d7d7-0000-4000-8000-000000000001',
  p_job_id           => (select id from public.job_posts where title = 'Design Ops Lead'),
  p_title            => 'Design Ops Lead',
  p_city_id          => 'e7e7e7e7-0000-4000-8000-000000000001',
  p_sector_id        => 'f7f7f7f7-0000-4000-8000-000000000001',
  p_job_title        => 'ux_designer',
  p_experience_level => 'mid_level',
  p_work_mode        => 'remote',
  p_employment_type  => 'contract',
  p_salary           => 'Not disclosed',
  p_description      => 'Run the design system.'
);

-- Pin the stamp to a value a save could never produce, then save the identical
-- posting: the stamp must come back untouched, because the member re-opened
-- the form and pressed save without changing a field.
update public.job_posts set updated_at = timestamptz '2026-01-01 00:00:00+00'
  where title = 'Design Ops Lead';

select is(
  (select edited_at from public.update_job_post(
     p_actor_id         => 'd7d7d7d7-0000-4000-8000-000000000001',
     p_job_id           => (select id from public.job_posts where title = 'Design Ops Lead'),
     p_title            => 'Design Ops Lead',
     p_city_id          => 'e7e7e7e7-0000-4000-8000-000000000001',
     p_sector_id        => 'f7f7f7f7-0000-4000-8000-000000000001',
     p_job_title        => 'ux_designer',
     p_experience_level => 'mid_level',
     p_work_mode        => 'remote',
     p_employment_type  => 'contract',
     p_salary           => 'Not disclosed',
     p_description      => 'Run the design system.'
  )),
  timestamptz '2026-01-01 00:00:00+00',
  'a save that changes nothing leaves the edit stamp alone'
);

select is(
  public.failure_message($$
    select * from public.update_job_post(
      p_actor_id         => 'd7d7d7d7-0000-4000-8000-000000000003',
      p_job_id           => (select id from public.job_posts where title = 'Design Ops Lead'),
      p_title            => 'Hijacked',
      p_city_id          => 'e7e7e7e7-0000-4000-8000-000000000001',
      p_sector_id        => 'f7f7f7f7-0000-4000-8000-000000000001',
      p_job_title        => 'ux_designer',
      p_experience_level => 'mid_level',
      p_work_mode        => 'remote',
      p_employment_type  => 'contract',
      p_salary           => null,
      p_description      => 'Not mine to edit.'
    )
  $$),
  'not_your_job',
  'only the poster can edit their posting'
);

select is(
  public.failure_message($$
    select * from public.update_job_post(
      p_actor_id         => 'd7d7d7d7-0000-4000-8000-000000000001',
      p_job_id           => '00000000-0000-4000-8000-000000000000',
      p_title            => 'Ghost',
      p_city_id          => 'e7e7e7e7-0000-4000-8000-000000000001',
      p_sector_id        => 'f7f7f7f7-0000-4000-8000-000000000001',
      p_job_title        => 'ux_designer',
      p_experience_level => 'mid_level',
      p_work_mode        => 'remote',
      p_employment_type  => 'contract',
      p_salary           => null,
      p_description      => 'Ghost.'
    )
  $$),
  'job_not_found',
  'editing a missing posting is refused'
);

select is(
  public.failure_message($$
    select * from public.update_job_post(
      p_actor_id         => 'd7d7d7d7-0000-4000-8000-000000000001',
      p_job_id           => (select id from public.job_posts where title = 'Design Ops Lead'),
      p_title            => 'Design Ops Lead',
      p_city_id          => 'e7e7e7e7-0000-4000-8000-000000000001',
      p_sector_id        => 'f7f7f7f7-0000-4000-8000-000000000001',
      p_job_title        => 'ux_designer',
      p_experience_level => 'mid_level',
      p_work_mode        => 'remote',
      p_employment_type  => 'contract',
      p_salary           => null,
      p_description      => '   '
    )
  $$),
  'missing_description',
  'an edit cannot store a blank description'
);

select is(
  public.failure_message($$
    select * from public.update_job_post(
      p_actor_id         => 'd7d7d7d7-0000-4000-8000-000000000001',
      p_job_id           => (select id from public.job_posts where title = 'Design Ops Lead'),
      p_title            => 'Design Ops Lead',
      p_city_id          => '00000000-0000-4000-8000-000000000000',
      p_sector_id        => 'f7f7f7f7-0000-4000-8000-000000000001',
      p_job_title        => 'ux_designer',
      p_experience_level => 'mid_level',
      p_work_mode        => 'remote',
      p_employment_type  => 'contract',
      p_salary           => null,
      p_description      => 'Run the design system.'
    )
  $$),
  'invalid_city',
  'an edit cannot store a city outside the master data'
);

-- The list fields are not on the edit form. A NULL list means "leave the
-- stored one alone", so an edit must never blank what it never showed.
update public.job_posts set responsibilities = array['Keep the system honest']
  where title = 'Design Ops Lead';

select count(*) from public.update_job_post(
  p_actor_id         => 'd7d7d7d7-0000-4000-8000-000000000001',
  p_job_id           => (select id from public.job_posts where title = 'Design Ops Lead'),
  p_title            => 'Design Ops Lead',
  p_city_id          => 'e7e7e7e7-0000-4000-8000-000000000001',
  p_sector_id        => 'f7f7f7f7-0000-4000-8000-000000000001',
  p_job_title        => 'ux_designer',
  p_experience_level => 'mid_level',
  p_work_mode        => 'remote',
  p_employment_type  => 'contract',
  p_salary           => 'Not disclosed',
  p_description      => 'Run the design system.'
);

select is(
  (select responsibilities from public.job_posts where title = 'Design Ops Lead'),
  array['Keep the system honest'],
  'an edit that omits the list fields leaves them alone'
);

-- ─── 9. Locked criteria once an application exists ──────────

select is(
  public.failure_message($$
    select * from public.update_job_post(
      p_actor_id         => 'd7d7d7d7-0000-4000-8000-000000000001',
      p_job_id           => (select id from public.job_posts where title = 'Senior Product Designer'),
      p_title            => 'Senior Product Designer',
      p_city_id          => 'e7e7e7e7-0000-4000-8000-000000000002',
      p_sector_id        => 'f7f7f7f7-0000-4000-8000-000000000001',
      p_job_title        => 'product_designer',
      p_experience_level => 'mid_level',
      p_work_mode        => 'hybrid',
      p_employment_type  => 'full_time',
      p_salary           => null,
      p_description      => 'Design payments flows.'
    )
  $$),
  'criteria_locked',
  'the city cannot move once an application exists'
);

-- Checked before the master data, so the reason stays the lock rather than a
-- shape error about a slug the posting never asked for.
select is(
  public.failure_message($$
    select * from public.update_job_post(
      p_actor_id         => 'd7d7d7d7-0000-4000-8000-000000000001',
      p_job_id           => (select id from public.job_posts where title = 'Senior Product Designer'),
      p_title            => 'Senior Product Designer',
      p_city_id          => 'e7e7e7e7-0000-4000-8000-000000000001',
      p_sector_id        => 'f7f7f7f7-0000-4000-8000-000000000001',
      p_job_title        => 'product_designer',
      p_experience_level => 'lead_principal',
      p_work_mode        => 'hybrid',
      p_employment_type  => 'full_time',
      p_salary           => null,
      p_description      => 'Design payments flows.'
    )
  $$),
  'criteria_locked',
  'the experience level cannot move once an application exists'
);

select is(
  (select edited_at is not null from public.update_job_post(
     p_actor_id         => 'd7d7d7d7-0000-4000-8000-000000000001',
     p_job_id           => (select id from public.job_posts where title = 'Senior Product Designer'),
     p_title            => 'Senior Product Designer',
     p_city_id          => 'e7e7e7e7-0000-4000-8000-000000000001',
     p_sector_id        => 'f7f7f7f7-0000-4000-8000-000000000001',
     p_job_title        => 'product_designer',
     p_experience_level => 'mid_level',
     p_work_mode        => 'hybrid',
     p_employment_type  => 'contract',
     p_salary           => '₹30–40L / year',
     p_description      => 'Edited: own the payments flow end to end.'
  )),
  true,
  'the rest of the posting stays editable once an application exists'
);

select is(
  (select description from public.job_posts where title = 'Senior Product Designer'),
  'Edited: own the payments flow end to end.',
  'the edit is stored'
);

select is(
  (select city_id::text || '|' || job_title
   from public.job_posts where title = 'Senior Product Designer'),
  'e7e7e7e7-0000-4000-8000-000000000001|product_designer',
  'the locked criteria did not move with the edit'
);

select is(
  (select count(*) from public.job_applications
   where job_id = (select id from public.job_posts where title = 'Senior Product Designer')),
  1::bigint,
  'an edit leaves the applications in place'
);

-- ─── 10. Closing and reopening ──────────────────────────────
-- Closing is the graceful end: it keeps the row, its URL and its history
-- while it stops taking applications, and it is reversible — so the browse
-- feed drops it for everyone else while its owner keeps seeing it.

select is(
  public.failure_message($$
    select * from public.set_job_post_status(
      'd7d7d7d7-0000-4000-8000-000000000003',
      (select id from public.job_posts where title = 'Design Ops Lead'),
      'closed'
    )
  $$),
  'not_your_job',
  'only the poster can close their posting'
);

select is(
  public.failure_message($$
    select * from public.set_job_post_status(
      'd7d7d7d7-0000-4000-8000-000000000001',
      (select id from public.job_posts where title = 'Design Ops Lead'),
      'archived'
    )
  $$),
  'invalid_status',
  'only open / closed are valid statuses'
);

-- The baseline the close flips: this member matches the posting, is not its
-- poster, and has not applied.
select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000007')
          ->> 'can_apply'
   from public.job_posts as jp where jp.title = 'Design Ops Lead'),
  'true',
  'a matched member may apply to the open posting'
);

select is(
  (select job_status from public.set_job_post_status(
     'd7d7d7d7-0000-4000-8000-000000000001',
     (select id from public.job_posts where title = 'Design Ops Lead'),
     'closed'
  )),
  'closed',
  'the poster closes the posting'
);

select is(
  public.failure_message($$
    select * from public.apply_to_job(
      (select id from public.job_posts where title = 'Design Ops Lead'),
      'd7d7d7d7-0000-4000-8000-000000000007',
      'Opener', 'https://portfolio.opener.test',
      'https://www.linkedin.com/in/opener', null
    )
  $$),
  'job_closed',
  'a closed posting takes no applications'
);

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000007')
          ->> 'can_apply'
   from public.job_posts as jp where jp.title = 'Design Ops Lead'),
  'false',
  'the Apply flag closes with the posting'
);

select is(
  (select count(*) from public.get_job_feed('d7d7d7d7-0000-4000-8000-000000000003')),
  1::bigint,
  'a closed posting leaves the browse feed'
);

select is(
  (select count(*) from public.get_job_feed('d7d7d7d7-0000-4000-8000-000000000001')),
  2::bigint,
  'a closed posting stays in its owner''s feed, so it can be reopened'
);

select is(
  (select job_status from public.set_job_post_status(
     'd7d7d7d7-0000-4000-8000-000000000001',
     (select id from public.job_posts where title = 'Design Ops Lead'),
     'open'
  )),
  'open',
  'the poster reopens it'
);

select is(
  (select count(*) from public.apply_to_job(
     (select id from public.job_posts where title = 'Design Ops Lead'),
     'd7d7d7d7-0000-4000-8000-000000000007',
     'Opener', 'https://portfolio.opener.test',
     'https://www.linkedin.com/in/opener', null
  )),
  1::bigint,
  'reopening really reopens — the same member may now apply'
);

-- ─── 11. Deleting ───────────────────────────────────────────
-- The irreversible one, and the only one that takes applications with it.

select is(
  public.failure_message($$
    select * from public.delete_job_post(
      'd7d7d7d7-0000-4000-8000-000000000003',
      (select id from public.job_posts where title = 'Design Ops Lead')
    )
  $$),
  'not_your_job',
  'only the poster can delete their posting'
);

select is(
  public.failure_message($$
    select * from public.delete_job_post(
      'd7d7d7d7-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000000'
    )
  $$),
  'job_not_found',
  'deleting a missing posting is refused'
);

select is(
  (select count(*) from public.delete_job_post(
     'd7d7d7d7-0000-4000-8000-000000000001',
     (select id from public.job_posts where title = 'Design Ops Lead')
  )),
  1::bigint,
  'the poster deletes their posting'
);

select is(
  (select count(*) from public.job_posts where title = 'Design Ops Lead'),
  0::bigint,
  'the posting is gone'
);

select is(
  (select count(*) from public.job_applications
   where applicant_id = 'd7d7d7d7-0000-4000-8000-000000000007'),
  0::bigint,
  'deleting a posting takes its applications with it'
);

-- ─── 12. The closing date ───────────────────────────────────
-- 20261009180000_job_expiry.sql. There is no scheduler here, so "auto-close"
-- is derived: one expression, job_post_is_open, decides whether a posting
-- takes applications, and the payload still reports the owner's own status so
-- Expired can be told apart from Closed.

select has_function('public', 'job_post_is_open', 'job_post_is_open(...) exists');

select is(
  public.job_post_is_open('open', null::timestamptz),
  true,
  'a posting with no deadline is open'
);

select is(
  public.job_post_is_open('open', now() + interval '1 day'),
  true,
  'a deadline still ahead keeps it open'
);

select is(
  public.job_post_is_open('open', now() - interval '1 day'),
  false,
  'a deadline that has passed closes it'
);

select is(
  public.job_post_is_open('closed', now() + interval '1 day'),
  false,
  'the owner''s lever wins over a deadline still ahead'
);

-- A fresh posting for the deadline cases, matching the Opener''s profile.
select count(*) from public.create_job_post(
  'd7d7d7d7-0000-4000-8000-000000000001', 'hiring',
  'a7a7a7a7-0000-4000-8000-000000000001', 'Expiring Role',
  'e7e7e7e7-0000-4000-8000-000000000001', 'f7f7f7f7-0000-4000-8000-000000000001',
  'ux_designer', 'mid_level', 'remote', 'full_time',
  null, 'A role with a closing date.',
  '{}', '{}', '{}', null, now() + interval '2 days'
);

select is(
  (select closes_at is not null from public.job_posts where title = 'Expiring Role'),
  true,
  'a posting can be created with a closing date'
);

select is(
  (select closes_at from public.job_posts where title = 'Senior Product Designer'),
  null::timestamptz,
  'a posting created before the deadline existed has none'
);

select is(
  (select (public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000007')
           ->> 'closes_at')::timestamptz
   from public.job_posts as jp where jp.title = 'Expiring Role'),
  (select closes_at from public.job_posts where title = 'Expiring Role'),
  'the payload carries the deadline'
);

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000007')
          ->> 'can_apply'
   from public.job_posts as jp where jp.title = 'Expiring Role'),
  'true',
  'a matched member may apply while the deadline is ahead'
);

-- Time passes: the deadline is now behind us.
update public.job_posts set closes_at = now() - interval '1 hour'
  where title = 'Expiring Role';

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000007')
          ->> 'status'
   from public.job_posts as jp where jp.title = 'Expiring Role'),
  'open',
  'an expired posting is still open as far as its owner''s status goes'
);

select is(
  (select public.job_post_payload(jp.id, 'd7d7d7d7-0000-4000-8000-000000000007')
          ->> 'can_apply'
   from public.job_posts as jp where jp.title = 'Expiring Role'),
  'false',
  'the Apply flag closes with the deadline'
);

select is(
  public.failure_message($$
    select * from public.apply_to_job(
      (select id from public.job_posts where title = 'Expiring Role'),
      'd7d7d7d7-0000-4000-8000-000000000007',
      'Opener', 'https://portfolio.opener.test',
      'https://www.linkedin.com/in/opener', null
    )
  $$),
  'job_expired',
  'applying to an expired posting is refused as expired, not as closed'
);

select is(
  (select count(*) from public.get_job_feed('d7d7d7d7-0000-4000-8000-000000000003')),
  1::bigint,
  'an expired posting leaves the browse feed'
);

select is(
  (select count(*) from public.get_job_feed('d7d7d7d7-0000-4000-8000-000000000001')),
  2::bigint,
  'an expired posting stays in its owner''s feed, so the date can be moved'
);

-- The owner closes it (with the deadline already behind us), then reopens it:
-- reopening cannot mean "open with a deadline in the past", so the deadline is
-- cleared rather than left to expire the posting again immediately.
select count(*) from public.set_job_post_status(
  'd7d7d7d7-0000-4000-8000-000000000001',
  (select id from public.job_posts where title = 'Expiring Role'),
  'closed'
);

select count(*) from public.set_job_post_status(
  'd7d7d7d7-0000-4000-8000-000000000001',
  (select id from public.job_posts where title = 'Expiring Role'),
  'open'
);

select is(
  (select closes_at from public.job_posts where title = 'Expiring Role'),
  null::timestamptz,
  'reopening clears a deadline that has already passed'
);

select is(
  (select count(*) from public.apply_to_job(
     (select id from public.job_posts where title = 'Expiring Role'),
     'd7d7d7d7-0000-4000-8000-000000000007',
     'Opener', 'https://portfolio.opener.test',
     'https://www.linkedin.com/in/opener', null
  )),
  1::bigint,
  'the reopened posting takes applications again'
);

-- The deadline is not part of the criteria freeze: it moves even though the
-- posting now has an applicant.
select count(*) from public.update_job_post(
  p_actor_id         => 'd7d7d7d7-0000-4000-8000-000000000001',
  p_job_id           => (select id from public.job_posts where title = 'Expiring Role'),
  p_title            => 'Expiring Role',
  p_city_id          => 'e7e7e7e7-0000-4000-8000-000000000001',
  p_sector_id        => 'f7f7f7f7-0000-4000-8000-000000000001',
  p_job_title        => 'ux_designer',
  p_experience_level => 'mid_level',
  p_work_mode        => 'remote',
  p_employment_type  => 'full_time',
  p_salary           => null,
  p_description      => 'A role with a closing date.',
  p_closes_at        => timestamptz '2026-12-31 23:59:59.999+00'
);

select is(
  (select closes_at from public.job_posts where title = 'Expiring Role'),
  timestamptz '2026-12-31 23:59:59.999+00',
  'an edit can move the deadline even once an application exists'
);

-- And clear it, which is how a poster says "no deadline".
select count(*) from public.update_job_post(
  p_actor_id         => 'd7d7d7d7-0000-4000-8000-000000000001',
  p_job_id           => (select id from public.job_posts where title = 'Expiring Role'),
  p_title            => 'Expiring Role',
  p_city_id          => 'e7e7e7e7-0000-4000-8000-000000000001',
  p_sector_id        => 'f7f7f7f7-0000-4000-8000-000000000001',
  p_job_title        => 'ux_designer',
  p_experience_level => 'mid_level',
  p_work_mode        => 'remote',
  p_employment_type  => 'full_time',
  p_salary           => null,
  p_description      => 'A role with a closing date.',
  p_closes_at        => null
);

select is(
  (select closes_at from public.job_posts where title = 'Expiring Role'),
  null::timestamptz,
  'an edit can clear the deadline'
);

select is(
  (select count(*) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('create_job_post', 'update_job_post')),
  2::bigint,
  'the pre-deadline overloads are gone — one of each write remains'
);

select finish();

rollback;
