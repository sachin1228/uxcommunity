-- ============================================================
-- Jobs — a posting's closing date
--
-- WHY
--   A role that is filled stops taking applications, and the poster
--   often knows roughly when that will be. Asking them to come back
--   and press Close on the right morning does not happen, so a
--   posting keeps collecting applications nobody reads. A closing
--   date is the poster saying it in advance.
--
--   There is no scheduler in this stack (no cron, no background
--   worker), so "auto-close" is DERIVED rather than written: the
--   moment a deadline passes, every rule that reads a posting treats
--   it as closed — it leaves the browse feed, it refuses
--   applications, and the UI badges it Expired. Deriving it also
--   means it cannot drift from the write rule the way a scheduled
--   flip could: one function, `job_post_is_open`, and one instant —
--   the database's now() — sit behind all of it.
--
--   The stored `status` keeps its meaning: it is the OWNER's lever
--   ('open' / 'closed'). A past deadline is a second, independent
--   reason a posting is not taking applications, which is why the
--   payload reports `closes_at` rather than folding the two into one
--   value — the UI must be able to say Expired (deadline) apart from
--   Closed (the owner ended it).
--
-- WHAT
--   • job_posts gains `closes_at timestamptz` — the last instant it
--     accepts applications. NULL means no deadline, which is what
--     every existing posting gets.
--   • job_post_is_open(status, closes_at) — the one expression: open
--     AND (no deadline OR the deadline is still ahead). Used by the
--     payload's `can_apply`, the feed's visibility filter, and
--     `apply_to_job`, so all three agree by construction.
--   • create_job_post / update_job_post gain a trailing
--     `p_closes_at timestamptz default null`. Trailing and defaulted
--     so every existing positional call keeps working unchanged; the
--     app's own callers pass it by name. NULL clears the deadline.
--     Moving a deadline is not gated by `criteria_locked` — it
--     changes until when, not who is eligible.
--   • apply_to_job names the reason: 'job_closed' when the owner
--     ended it, 'job_expired' when the deadline passed.
--   • set_job_post_status('open') clears a deadline that has already
--     passed, because a past deadline cannot mean "open" — Reopen
--     must actually reopen rather than leave an Expired posting the
--     member cannot explain.
--   • job_post_payload carries `closes_at`; get_job_feed keeps a
--     posting that is not accepting applications out of the browse
--     list but still returns it to its owner, who is the one who can
--     close, reopen or re-date it.
--
-- Deploy note: CREATE OR REPLACE cannot widen a signature — it adds
-- an OVERLOAD, and a positional call then fails as ambiguous (a
-- 16-argument create_job_post could match either version). So both
-- replacements are created first and the pre-deadline overloads are
-- dropped after, which leaves a single unambiguous function at the
-- end and never a moment with none: an app call passing p_closes_at
-- by name resolves to the new function even before the drop. Apply
-- after 20261009170000_job_lifecycle.sql.
-- ============================================================

alter table public.job_posts
  add column if not exists closes_at timestamptz;

-- ─── The one expression every reader agrees on ──────────────

create or replace function public.job_post_is_open(
  p_status    text,
  p_closes_at timestamptz
)
returns boolean
language sql
stable
set search_path = ''
as $$
  -- A posting with no deadline is open until its owner closes it; one with a
  -- deadline is open up to that instant and not a moment after.
  select p_status = 'open'
     and (p_closes_at is null or p_closes_at > pg_catalog.now());
$$;

comment on function public.job_post_is_open(text, timestamptz) is
  'Whether a posting accepts applications right now: the owner has not closed it and no deadline has passed. The single rule behind can_apply, the feed filter and apply_to_job.';

-- ─── Posting a job, now with a deadline ─────────────────────

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
  p_website          text default null,
  -- Trailing and defaulted: an existing positional call is still a valid call
  -- (it simply posts without a deadline), and the API passes it by name.
  p_closes_at        timestamptz default null
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
    responsibilities, requirements, skills, website, closes_at
  )
  values (
    p_poster_id, p_company_id, v_kind, v_title,
    p_city_id, p_sector_id, v_job_title, v_experience,
    p_work_mode, p_employment_type, left(v_salary, 80), v_description,
    v_responsibilities, v_requirements, v_skills, v_website, p_closes_at
  )
  returning jp.id, jp.created_at;
end;
$$;

-- ─── Editing a posting, now with a deadline ─────────────────
-- Same rules as 20261009170000_job_lifecycle.sql: the four targeting criteria
-- freeze once an application exists, the list fields are left alone when the
-- caller does not send them, and a save that changes nothing does not move
-- updated_at. `closes_at` is NOT part of the freeze — it moves freely.

create or replace function public.update_job_post(
  p_actor_id         uuid,
  p_job_id           uuid,
  p_title            text,
  p_city_id          uuid,
  p_sector_id        uuid,
  p_job_title        text,
  p_experience_level text,
  p_work_mode        text,
  p_employment_type  text,
  p_salary           text,
  p_description      text,
  p_responsibilities text[] default null,
  p_requirements     text[] default null,
  p_skills           text[] default null,
  p_website          text default null,
  -- Trailing and defaulted so every existing positional call still resolves;
  -- the edit route always states it, and NULL clears the deadline.
  p_closes_at        timestamptz default null
)
returns table (job_id uuid, edited_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job         public.job_posts%rowtype;
  v_title       text := btrim(coalesce(p_title, ''));
  v_job_title   text := btrim(coalesce(p_job_title, ''));
  v_experience  text := btrim(coalesce(p_experience_level, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_salary      text := nullif(btrim(coalesce(p_salary, '')), '');
  v_website     text := nullif(btrim(coalesce(p_website, '')), '');
  v_locked      boolean;
  v_responsibilities text[];
  v_requirements     text[];
  v_skills           text[];
begin
  select * into v_job from public.job_posts as jp where jp.id = p_job_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'job_not_found';
  end if;

  if v_job.poster_id is distinct from p_actor_id then
    raise exception using errcode = 'P0001', message = 'not_your_job';
  end if;

  -- The gate that makes this edit safe: the four dimensions
  -- apply_to_job compares against a member's profile cannot move once
  -- anybody has applied. Checked before the field validation so the
  -- reason a save was refused is never buried under a shape error.
  v_locked := exists (
    select 1 from public.job_applications as ja where ja.job_id = p_job_id
  );

  if v_locked and (
       v_job.city_id          is distinct from p_city_id
       or v_job.sector_id     is distinct from p_sector_id
       or v_job.job_title     is distinct from v_job_title
       or v_job.experience_level is distinct from v_experience
     ) then
    raise exception using errcode = 'P0001', message = 'criteria_locked';
  end if;

  -- Everything below mirrors create_job_post: an edit can never store
  -- a shape the create path would have refused.
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

  -- Same normalisation as the create write — trimmed, blank rows dropped,
  -- capped at 20 items — but only for a list the caller actually sent. A NULL
  -- (or absent) list carries the stored one through untouched, which also
  -- keeps it out of the change test below: an edit that never mentioned the
  -- lists must not read as "this posting changed".
  if p_responsibilities is null then
    v_responsibilities := v_job.responsibilities;
  else
    v_responsibilities := (
      select coalesce((array_agg(left(btrim(item), 200) order by ord))[1:20], '{}')
      from unnest(p_responsibilities) with ordinality as t (item, ord)
      where btrim(item) <> ''
    );
  end if;

  if p_requirements is null then
    v_requirements := v_job.requirements;
  else
    v_requirements := (
      select coalesce((array_agg(left(btrim(item), 200) order by ord))[1:20], '{}')
      from unnest(p_requirements) with ordinality as t (item, ord)
      where btrim(item) <> ''
    );
  end if;

  if p_skills is null then
    v_skills := v_job.skills;
  else
    v_skills := (
      select coalesce((array_agg(left(btrim(item), 60) order by ord))[1:20], '{}')
      from unnest(p_skills) with ordinality as t (item, ord)
      where btrim(item) <> ''
    );
  end if;

  -- The row comparison is the "did anything change" test: a save that
  -- changes nothing does not move updated_at, so the posting never
  -- advertises an edit that did not happen.
  return query
  with updated as (
    update public.job_posts as jp
       set title            = v_title,
           city_id          = p_city_id,
           sector_id        = p_sector_id,
           job_title        = v_job_title,
           experience_level = v_experience,
           work_mode        = p_work_mode,
           employment_type  = p_employment_type,
           salary           = left(v_salary, 80),
           description      = v_description,
           closes_at        = p_closes_at,
           responsibilities = v_responsibilities,
           requirements     = v_requirements,
           skills           = v_skills,
           website          = v_website,
           updated_at       = now()
     where jp.id = p_job_id
       and (
         jp.title, jp.city_id, jp.sector_id, jp.job_title, jp.experience_level,
         jp.work_mode, jp.employment_type, jp.salary, jp.description, jp.closes_at,
         jp.responsibilities, jp.requirements, jp.skills, jp.website
       ) is distinct from (
         v_title, p_city_id, p_sector_id, v_job_title, v_experience,
         p_work_mode, p_employment_type, left(v_salary, 80), v_description, p_closes_at,
         v_responsibilities, v_requirements, v_skills, v_website
       )
    returning jp.id, jp.updated_at
  )
  select updated.id, updated.updated_at from updated;

  if not found then
    return query
    select jp.id, jp.updated_at from public.job_posts as jp where jp.id = p_job_id;
  end if;
end;
$$;

-- ─── Closing / reopening: reopening clears a passed deadline ──

create or replace function public.set_job_post_status(
  p_actor_id uuid,
  p_job_id   uuid,
  p_status   text
)
returns table (job_id uuid, job_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := btrim(coalesce(p_status, ''));
begin
  if v_status not in ('open', 'closed') then
    raise exception using errcode = '22023', message = 'invalid_status';
  end if;

  -- Owner-scoped in the write itself, so the check and the change are
  -- one statement: nobody can win a race between them. Closing does
  -- not touch updated_at — the content did not change.
  --
  -- Reopening cannot mean "open with a deadline in the past": a deadline
  -- that has already passed is cleared, so Reopen genuinely reopens rather
  -- than leaving an Expired posting the member cannot explain.
  return query
  with updated as (
    update public.job_posts as jp
       set status = v_status,
           closes_at = case
             when v_status = 'open'
              and jp.closes_at is not null
              and jp.closes_at <= pg_catalog.now()
               then null
             else jp.closes_at
           end
     where jp.id = p_job_id and jp.poster_id = p_actor_id
    returning jp.id, jp.status
  )
  select updated.id, updated.status from updated;

  -- Say which refusal it was: the posting is gone, or it is not theirs.
  if not found then
    if exists (select 1 from public.job_posts as jp where jp.id = p_job_id) then
      raise exception using errcode = 'P0001', message = 'not_your_job';
    end if;
    raise exception using errcode = 'P0002', message = 'job_not_found';
  end if;
end;
$$;

-- ─── Applying: the deadline is a refusal with its own reason ──

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

  -- One gate, read from the shared rule, with the reason named for the member
  -- reading it: the owner ended the posting, or its deadline passed.
  if not public.job_post_is_open(v_job.status, v_job.closes_at) then
    if v_job.status <> 'open' then
      raise exception using errcode = 'P0001', message = 'job_closed';
    end if;
    raise exception using errcode = 'P0001', message = 'job_expired';
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

-- ─── Reads: the payload carries the deadline ────────────────
-- Create-or-replace of the 20261009170000_job_lifecycle.sql definition plus
-- `closes_at`; the poster's profile company rides along from
-- 20261009160000_job_poster_company.sql.

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
    'status', jp.status,
    'updated_at', jp.updated_at,
    -- The deadline and its verdict travel together: the client renders the
    -- date, and `can_apply` below is the authority on whether it still counts.
    'closes_at', jp.closes_at,
    'company', jsonb_build_object(
      'id', co.id,
      'name', co.name,
      'slug', co.slug,
      'logo_url', co.logo_url,
      -- The display domain: verified first, else the directory's best hint
      -- (same ordering search_companies uses), so the logo resolves the same
      -- way everywhere. `domain_verified` still says whether a proof exists.
      'domain', (
        select d.domain from public.company_domains as d
        where d.company_id = co.id
        order by d.verified desc,
                 public.company_confidence_rank(d.evidence_confidence) desc,
                 d.created_at asc,
                 d.domain asc
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
      'experience_level_label', pel.name,
      -- Where the poster works, the same company their profile shows.
      'company_name', pc.name
    ),
    'applicant_count', (
      select count(*) from public.job_applications as ja where ja.job_id = jp.id
    ),
    -- The edit rule the database enforces, exposed so the form disables
    -- the four targeting fields instead of re-deriving when they lock.
    'criteria_locked', exists (
      select 1 from public.job_applications as ja where ja.job_id = jp.id
    ),
    'applied', exists (
      select 1 from public.job_applications as ja
      where ja.job_id = jp.id and ja.applicant_id = p_viewer_id
    ),
    'is_mine', jp.poster_id = p_viewer_id,
    -- The same rule apply_to_job enforces, read from the same function: the
    -- owner has not closed it and its deadline has not passed.
    'can_apply', (
      public.job_post_is_open(jp.status, jp.closes_at)
      and p_viewer_id is not null
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
  left join public.companies as pc on pc.id = pd.company_id
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

-- Newest-first page of postings, each rendered for the viewer. A posting that
-- is not accepting applications — closed by its owner or past its deadline —
-- leaves the browse list but stays readable by its owner, who is the one who
-- can close, reopen or re-date it.
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
    where public.job_post_is_open(jp.status, jp.closes_at)
       or jp.poster_id = p_viewer_id
    order by jp.created_at desc, jp.id desc
    limit least(greatest(coalesce(p_limit, 50), 1), 100)
  ) as p
  order by p.created_at desc, p.job_id desc;
$$;

-- ─── Retire the pre-deadline overloads ──────────────────────
-- Both replacements above added a signature rather than replacing one, so the
-- originals are dropped here: a positional 16-argument create_job_post could
-- otherwise match either version and PostgreSQL would refuse it as ambiguous.
-- Dropped after the new ones exist, so no moment leaves a job write missing,
-- and the app's named calls (which pass p_closes_at) never match the old ones.

drop function if exists public.create_job_post(
  uuid, text, uuid, text, uuid, uuid, text, text, text, text, text, text,
  text[], text[], text[], text
);

drop function if exists public.update_job_post(
  uuid, uuid, text, uuid, uuid, text, text, text, text, text, text,
  text[], text[], text[], text
);

-- ─── Execute grants ─────────────────────────────────────────
-- SECURITY DEFINER functions are callable by default by everyone;
-- close that door. Only the service-role client (the API routes)
-- may call these.

revoke all on function public.job_post_is_open(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.job_post_is_open(text, timestamptz)
  to service_role;

revoke all on function public.create_job_post(
  uuid, text, uuid, text, uuid, uuid, text, text, text, text, text, text,
  text[], text[], text[], text, timestamptz
) from public, anon, authenticated;
grant execute on function public.create_job_post(
  uuid, text, uuid, text, uuid, uuid, text, text, text, text, text, text,
  text[], text[], text[], text, timestamptz
) to service_role;

revoke all on function public.update_job_post(
  uuid, uuid, text, uuid, uuid, text, text, text, text, text, text,
  text[], text[], text[], text, timestamptz
) from public, anon, authenticated;
grant execute on function public.update_job_post(
  uuid, uuid, text, uuid, uuid, text, text, text, text, text, text,
  text[], text[], text[], text, timestamptz
) to service_role;
