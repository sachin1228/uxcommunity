-- ============================================================
-- Jobs — verified-company postings with profile-gated applications
--
-- WHY
--   Members can post a job for a company, and other members can
--   apply. Two rules make a posting trustworthy:
--
--     1. The company is REAL for the poster. Every post carries a
--        company on which the poster has proved membership with a
--        work email — the existing verified-company model
--        (20260929120000_company_verified_domains.sql). The
--        'hiring' kind is an official opening posted by a member
--        of the company; 'referral' is a member referring for the
--        company already verified on their profile. The proof is
--        the same; only the intent differs.
--     2. The posting is TARGETED. A post declares the same four
--        dimensions signup collects — city, sector, job title and
--        experience level — and only members whose profile matches
--        ALL FOUR can apply. Everyone can see the post; the match
--        is what unlocks the Apply action.
--
-- WHAT
--   • job_posts        — one row per posting. Criteria reference
--                        the same master data signup uses (cities /
--                        design_sectors by uuid, job_titles /
--                        experience_levels by slug).
--   • job_applications — one row per member per job, carrying
--                        exactly what the apply form collects:
--                        name, portfolio URL, LinkedIn URL and an
--                        optional resume (R2 URL).
--   • create_job_post / apply_to_job — the writes. Both re-check
--                        the proof and the profile match inside the
--                        database, so the client can never post
--                        without a verified company, and
--                        apply_to_job reads the APPLICANT's profile
--                        row (never a request field), so
--                        eligibility cannot be forged.
--   • get_job_feed / get_job_detail / get_job_applicants — reads.
--                        The feed returns the viewer's flags
--                        (can_apply, applied, is_mine) so the UI
--                        lock is computed by the same rule the
--                        write enforces.
--
-- Deploy note: pure addition — new tables and functions only, no
-- backfill and nothing dropped. Safe to apply before or after the
-- release that starts calling it.
-- ============================================================

-- ─── Postings ───────────────────────────────────────────────

create table if not exists public.job_posts (
  id               uuid primary key default gen_random_uuid(),
  poster_id        uuid not null references public.users (id) on delete cascade,
  -- The company the poster proved. Deleting a company takes its
  -- postings with it, mirroring company_members.
  company_id       uuid not null references public.companies (id) on delete cascade,
  -- 'hiring'   — an official opening posted by a member of the company.
  -- 'referral' — a member referring for their profile company.
  kind             text not null check (kind in ('hiring', 'referral')),
  title            text not null check (char_length(btrim(title)) between 2 and 140),
  -- The eligibility dimensions. RESTRICT mirrors designer_profiles:
  -- master data in use is retired with is_active, never deleted.
  city_id          uuid not null references public.cities (id) on delete restrict,
  sector_id        uuid not null references public.design_sectors (id) on delete restrict,
  job_title        text not null references public.job_titles (slug) on delete restrict,
  experience_level text not null references public.experience_levels (slug) on delete restrict,
  work_mode        text not null check (work_mode in ('remote', 'hybrid', 'onsite')),
  employment_type  text not null check (
                     employment_type in ('full_time', 'part_time', 'contract', 'internship')
                   ),
  -- Optional extras: an undisclosed salary stays NULL, a blank
  -- website is stored as NULL rather than an empty string.
  salary           text,
  description      text not null check (char_length(btrim(description)) between 1 and 8000),
  responsibilities text[] not null default '{}',
  requirements     text[] not null default '{}',
  skills           text[] not null default '{}',
  website          text check (website is null or website ~* '^https?://'),
  created_at       timestamptz not null default now()
);

create index if not exists idx_job_posts_created
  on public.job_posts (created_at desc, id desc);
create index if not exists idx_job_posts_poster
  on public.job_posts (poster_id);
create index if not exists idx_job_posts_company
  on public.job_posts (company_id);

-- ─── Applications ───────────────────────────────────────────

create table if not exists public.job_applications (
  id           uuid primary key default gen_random_uuid(),
  job_id       uuid not null references public.job_posts (id) on delete cascade,
  applicant_id uuid not null references public.users (id) on delete cascade,
  name         text not null check (char_length(btrim(name)) between 2 and 120),
  portfolio_url text not null check (portfolio_url ~* '^https?://'),
  linkedin_url  text not null check (linkedin_url ~* '^https?://'),
  -- Optional resume attachment (R2 public URL). Registered in
  -- packages/shared/src/r2-media.ts so the orphan audit treats it
  -- as a live reference.
  resume_url   text,
  created_at   timestamptz not null default now(),
  -- One application per member per job, enforced here so the
  -- write path's pre-check is only a nicer error, never the rule.
  constraint job_applications_job_applicant_key unique (job_id, applicant_id)
);

create index if not exists idx_job_applications_job
  on public.job_applications (job_id, created_at desc);
create index if not exists idx_job_applications_applicant
  on public.job_applications (applicant_id);

-- Reads and writes always go through the Next.js API's service-role
-- client, which bypasses RLS; the grants below close the PostgREST
-- door for everyone else.
alter table public.job_posts        enable row level security;
alter table public.job_applications enable row level security;
revoke all on table public.job_posts        from anon, authenticated;
revoke all on table public.job_applications from anon, authenticated;

-- ─── Posting a job ──────────────────────────────────────────

create or replace function public.create_job_post(
  p_poster_id        uuid,
  p_kind             text,
  p_company_id       uuid,
  p_title            text,
  p_city_id          uuid,
  p_sector_id        uuid,
  p_job_title        text,
  p_experience_level text,
  p_work_mode        text,
  p_employment_type  text,
  p_salary           text,
  p_description      text,
  p_responsibilities text[] default '{}',
  p_requirements     text[] default '{}',
  p_skills           text[] default '{}',
  p_website          text default null
)
returns table (job_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind        text := btrim(coalesce(p_kind, ''));
  v_title       text := btrim(coalesce(p_title, ''));
  v_job_title   text := btrim(coalesce(p_job_title, ''));
  v_experience  text := btrim(coalesce(p_experience_level, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_salary      text := nullif(btrim(coalesce(p_salary, '')), '');
  v_website     text := nullif(btrim(coalesce(p_website, '')), '');
  v_responsibilities text[];
  v_requirements     text[];
  v_skills           text[];
begin
  if p_poster_id is null
     or not exists (select 1 from public.users as u where u.id = p_poster_id) then
    raise exception using errcode = '23503', message = 'unknown_user';
  end if;

  if v_kind not in ('hiring', 'referral') then
    raise exception using errcode = '22023', message = 'invalid_kind';
  end if;

  if char_length(v_title) < 2 or char_length(v_title) > 140 then
    raise exception using errcode = '22023', message = 'invalid_title';
  end if;

  if v_description = '' then
    raise exception using errcode = '22023', message = 'missing_description';
  end if;

  if p_work_mode not in ('remote', 'hybrid', 'onsite') then
    raise exception using errcode = '22023', message = 'invalid_work_mode';
  end if;

  if p_employment_type not in ('full_time', 'part_time', 'contract', 'internship') then
    raise exception using errcode = '22023', message = 'invalid_employment_type';
  end if;

  if not exists (
    select 1 from public.companies as c
    where c.id = p_company_id and c.is_active
  ) then
    raise exception using errcode = 'P0001', message = 'company_inactive';
  end if;

  -- The company is only real for the poster once they have proved a
  -- work email on one of its domains. This is the same row the
  -- profile badge reads; a job can never be posted for a company
  -- the poster has not verified.
  if not exists (
    select 1 from public.company_members as m
    where m.company_id = p_company_id
      and m.user_id = p_poster_id
      and m.verified
  ) then
    raise exception using errcode = 'P0001', message = 'company_not_verified';
  end if;

  if not exists (
    select 1 from public.cities as ci
    where ci.id = p_city_id and ci.is_active
  ) then
    raise exception using errcode = '22023', message = 'invalid_city';
  end if;

  if not exists (
    select 1 from public.design_sectors as se
    where se.id = p_sector_id and se.is_active
  ) then
    raise exception using errcode = '22023', message = 'invalid_sector';
  end if;

  if not exists (
    select 1 from public.job_titles as jt
    where jt.slug = v_job_title and jt.is_active
  ) then
    raise exception using errcode = '22023', message = 'invalid_job_title';
  end if;

  if not exists (
    select 1 from public.experience_levels as el
    where el.slug = v_experience and el.is_active
  ) then
    raise exception using errcode = '22023', message = 'invalid_experience_level';
  end if;

  if v_website is not null and v_website !~* '^https?://' then
    raise exception using errcode = '22023', message = 'invalid_website';
  end if;

  -- List fields are stored trimmed, blank rows dropped, capped at 20
  -- items of 200 characters — the same normalisation the detail page
  -- renders back.
  v_responsibilities := (
    select coalesce((array_agg(left(btrim(item), 200) order by ord))[1:20], '{}')
    from unnest(coalesce(p_responsibilities, '{}'::text[])) with ordinality as t (item, ord)
    where btrim(item) <> ''
  );
  v_requirements := (
    select coalesce((array_agg(left(btrim(item), 200) order by ord))[1:20], '{}')
    from unnest(coalesce(p_requirements, '{}'::text[])) with ordinality as t (item, ord)
    where btrim(item) <> ''
  );
  v_skills := (
    select coalesce((array_agg(left(btrim(item), 60) order by ord))[1:20], '{}')
    from unnest(coalesce(p_skills, '{}'::text[])) with ordinality as t (item, ord)
    where btrim(item) <> ''
  );

  return query
  insert into public.job_posts as jp (
    poster_id, company_id, kind, title,
    city_id, sector_id, job_title, experience_level,
    work_mode, employment_type, salary, description,
    responsibilities, requirements, skills, website
  )
  values (
    p_poster_id, p_company_id, v_kind, v_title,
    p_city_id, p_sector_id, v_job_title, v_experience,
    p_work_mode, p_employment_type, left(v_salary, 80), v_description,
    v_responsibilities, v_requirements, v_skills, v_website
  )
  returning jp.id, jp.created_at;
end;
$$;

-- ─── Applying to a job ──────────────────────────────────────

create or replace function public.apply_to_job(
  p_job_id       uuid,
  p_applicant_id uuid,
  p_name         text,
  p_portfolio_url text,
  p_linkedin_url  text,
  p_resume_url    text default null
)
returns table (application_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job        public.job_posts%rowtype;
  v_name       text := btrim(coalesce(p_name, ''));
  v_portfolio  text := btrim(coalesce(p_portfolio_url, ''));
  v_linkedin   text := btrim(coalesce(p_linkedin_url, ''));
  v_resume     text := nullif(btrim(coalesce(p_resume_url, '')), '');
begin
  select * into v_job from public.job_posts as jp where jp.id = p_job_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'job_not_found';
  end if;

  if p_applicant_id is null
     or not exists (select 1 from public.users as u where u.id = p_applicant_id) then
    raise exception using errcode = '23503', message = 'unknown_user';
  end if;

  if v_job.poster_id = p_applicant_id then
    raise exception using errcode = 'P0001', message = 'own_job';
  end if;

  if char_length(v_name) < 2 or char_length(v_name) > 120 then
    raise exception using errcode = '22023', message = 'invalid_name';
  end if;

  if v_portfolio !~* '^https?://' then
    raise exception using errcode = '22023', message = 'invalid_portfolio_url';
  end if;

  if v_linkedin !~* '^https?://'
     or position('linkedin.com' in lower(v_linkedin)) = 0 then
    raise exception using errcode = '22023', message = 'invalid_linkedin_url';
  end if;

  if v_resume is not null and v_resume !~* '^https?://' then
    raise exception using errcode = '22023', message = 'invalid_resume_url';
  end if;

  -- The gate: the applicant's OWN profile must match all four
  -- dimensions of the posting. Read from the profile row — never
  -- from the request — so a crafted call cannot widen eligibility.
  if not exists (
    select 1 from public.designer_profiles as dp
    where dp.user_id = p_applicant_id
      and dp.city_id = v_job.city_id
      and dp.sector_id = v_job.sector_id
      and dp.job_title = v_job.job_title
      and dp.experience_level = v_job.experience_level
  ) then
    raise exception using errcode = 'P0001', message = 'not_eligible';
  end if;

  if exists (
    select 1 from public.job_applications as ja
    where ja.job_id = p_job_id and ja.applicant_id = p_applicant_id
  ) then
    raise exception using errcode = 'P0001', message = 'already_applied';
  end if;

  begin
    return query
    insert into public.job_applications as ja (
      job_id, applicant_id, name, portfolio_url, linkedin_url, resume_url
    )
    values (
      p_job_id, p_applicant_id, v_name, v_portfolio, v_linkedin, v_resume
    )
    returning ja.id, ja.created_at;
  exception
    -- Two concurrent submissions: the unique constraint is the rule,
    -- the check above is only the friendlier error.
    when unique_violation then
      raise exception using errcode = 'P0001', message = 'already_applied';
  end;
end;
$$;

-- ─── Reads ──────────────────────────────────────────────────

-- One posting rendered for one viewer: every field the card and the
-- detail page need, plus the viewer flags computed by the same rule
-- `apply_to_job` enforces. `can_apply` is authority; the client
-- derives only the human-readable mismatch reason from it.
create or replace function public.job_post_payload(
  p_job_id    uuid,
  p_viewer_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', jp.id,
    'kind', jp.kind,
    'title', jp.title,
    'description', jp.description,
    'responsibilities', to_jsonb(jp.responsibilities),
    'requirements', to_jsonb(jp.requirements),
    'skills', to_jsonb(jp.skills),
    'salary', jp.salary,
    'website', jp.website,
    'work_mode', jp.work_mode,
    'employment_type', jp.employment_type,
    'city_id', jp.city_id,
    'city_name', ci.name,
    'sector_id', jp.sector_id,
    'sector_name', se.name,
    'job_title', jp.job_title,
    'job_title_label', coalesce(jt.name, jp.job_title),
    'experience_level', jp.experience_level,
    'experience_level_label', coalesce(el.name, jp.experience_level),
    'created_at', jp.created_at,
    'company', jsonb_build_object(
      'id', co.id,
      'name', co.name,
      'slug', co.slug,
      'logo_url', co.logo_url,
      'domain', (
        select d.domain from public.company_domains as d
        where d.company_id = co.id and d.verified
        order by d.verified_at asc nulls last
        limit 1
      ),
      'domain_verified', exists (
        select 1 from public.company_domains as d
        where d.company_id = co.id and d.verified
      )
    ),
    'poster', jsonb_build_object(
      'id', pu.id,
      'name', pu.name,
      'avatar_url', pd.avatar_url,
      'job_title', pd.job_title,
      'job_title_label', pjt.name,
      'experience_level', pd.experience_level,
      'experience_level_label', pel.name
    ),
    'applicant_count', (
      select count(*) from public.job_applications as ja where ja.job_id = jp.id
    ),
    'applied', exists (
      select 1 from public.job_applications as ja
      where ja.job_id = jp.id and ja.applicant_id = p_viewer_id
    ),
    'is_mine', jp.poster_id = p_viewer_id,
    'can_apply', (
      p_viewer_id is not null
      and jp.poster_id <> p_viewer_id
      and not exists (
        select 1 from public.job_applications as ja
        where ja.job_id = jp.id and ja.applicant_id = p_viewer_id
      )
      and exists (
        select 1 from public.designer_profiles as vp
        where vp.user_id = p_viewer_id
          and vp.city_id = jp.city_id
          and vp.sector_id = jp.sector_id
          and vp.job_title = jp.job_title
          and vp.experience_level = jp.experience_level
      )
    ),
    'my_application', ma.application
  )
  from public.job_posts as jp
  join public.companies as co on co.id = jp.company_id
  join public.users as pu on pu.id = jp.poster_id
  left join public.designer_profiles as pd on pd.user_id = jp.poster_id
  left join public.job_titles as pjt on pjt.slug = pd.job_title
  left join public.experience_levels as pel on pel.slug = pd.experience_level
  left join public.cities as ci on ci.id = jp.city_id
  left join public.design_sectors as se on se.id = jp.sector_id
  left join public.job_titles as jt on jt.slug = jp.job_title
  left join public.experience_levels as el on el.slug = jp.experience_level
  left join lateral (
    select jsonb_build_object(
      'id', ja.id,
      'name', ja.name,
      'portfolio_url', ja.portfolio_url,
      'linkedin_url', ja.linkedin_url,
      'resume_url', ja.resume_url,
      'created_at', ja.created_at
    ) as application
    from public.job_applications as ja
    where ja.job_id = jp.id and ja.applicant_id = p_viewer_id
  ) as ma on true
  where jp.id = p_job_id;
$$;

/** Newest-first page of postings, each rendered for the viewer. */
create or replace function public.get_job_feed(
  p_viewer_id uuid,
  p_limit     integer default 50
)
returns table (item jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select public.job_post_payload(p.job_id, p_viewer_id) as item
  from (
    select jp.id as job_id, jp.created_at
    from public.job_posts as jp
    order by jp.created_at desc, jp.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) as p
  order by p.created_at desc, p.job_id desc;
$$;

/** One posting; empty set when it does not exist. */
create or replace function public.get_job_detail(
  p_job_id    uuid,
  p_viewer_id uuid
)
returns table (item jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select public.job_post_payload(p_job_id, p_viewer_id) as item
  where exists (select 1 from public.job_posts as jp where jp.id = p_job_id);
$$;

-- The applicants board is the poster's own surface: anyone else is
-- refused outright, not shown an empty list.
create or replace function public.get_job_applicants(
  p_poster_id uuid,
  p_job_id    uuid
)
returns table (item jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.job_posts as jp
    where jp.id = p_job_id and jp.poster_id = p_poster_id
  ) then
    raise exception using errcode = 'P0001', message = 'not_your_job';
  end if;

  return query
  select jsonb_build_object(
    'id', ja.id,
    'applicant_id', ja.applicant_id,
    'name', ja.name,
    'portfolio_url', ja.portfolio_url,
    'linkedin_url', ja.linkedin_url,
    'resume_url', ja.resume_url,
    'created_at', ja.created_at,
    'avatar_url', dp.avatar_url
  )
  from public.job_applications as ja
  left join public.designer_profiles as dp on dp.user_id = ja.applicant_id
  where ja.job_id = p_job_id
  order by ja.created_at desc, ja.id desc;
end;
$$;

-- ─── Execute grants ─────────────────────────────────────────
-- SECURITY DEFINER functions are callable by default by everyone;
-- close that door. Only the service-role client (the API routes)
-- may call these.

revoke all on function public.create_job_post(
  uuid, text, uuid, text, uuid, uuid, text, text, text, text, text, text,
  text[], text[], text[], text
) from public, anon, authenticated;
grant execute on function public.create_job_post(
  uuid, text, uuid, text, uuid, uuid, text, text, text, text, text, text,
  text[], text[], text[], text
) to service_role;

revoke all on function public.apply_to_job(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_to_job(uuid, uuid, text, text, text, text)
  to service_role;

revoke all on function public.job_post_payload(uuid, uuid) from public, anon, authenticated;
grant execute on function public.job_post_payload(uuid, uuid) to service_role;

revoke all on function public.get_job_feed(uuid, integer) from public, anon, authenticated;
grant execute on function public.get_job_feed(uuid, integer) to service_role;

revoke all on function public.get_job_detail(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_job_detail(uuid, uuid) to service_role;

revoke all on function public.get_job_applicants(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_job_applicants(uuid, uuid) to service_role;
