-- ============================================================
-- The company domain a display surface shows
--
-- WHY
--   A company's picture is resolved from a domain (favicon), and the
--   company picker already uses "the domain the company is known by":
--   its verified domain when someone proved one, else the directory's
--   best hint (the ordering search_companies uses). The profile and
--   the jobs surfaces instead only ever read a VERIFIED domain, so a
--   company joined via a mailbox-only proof — the membership is real,
--   the domain claim stays an unproved hint — rendered its letter
--   placeholder there while the picker showed the actual mark. The
--   same company looked different on different pages.
--
-- WHAT
--   `get_user_company` and `job_post_payload` now pick the display
--   domain with the picker's ordering:
--     verified desc, confidence rank desc, created_at asc, domain asc
--   `domain_verified` keeps its proof meaning: the selected row's
--   verified flag for get_user_company, "a verified domain exists"
--   for the jobs payload. Membership and proof semantics are
--   untouched — "Verified via X" copy must gate on domain_verified,
--   not on the domain being present.
--
-- Deploy note: create-or-replace of two existing functions only; no
-- schema change, no backfill. Apply after 20261009120000_jobs.sql.
-- ============================================================

-- ─── The profile's company row ──────────────────────────────

create or replace function public.get_user_company(p_user_id uuid)
returns table (
  company_id         uuid,
  name               text,
  slug               text,
  logo_url           text,
  is_active          boolean,
  domain             text,
  domain_verified    boolean,
  membership_verified boolean,
  joined_at          timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    c.name,
    c.slug,
    c.logo_url,
    c.is_active,
    domain_row.domain,
    coalesce(domain_row.verified, false),
    coalesce(m.verified, false),
    m.joined_at
  from public.designer_profiles as dp
  join public.companies as c on c.id = dp.company_id
  left join public.company_members as m
    on m.company_id = c.id and m.user_id = dp.user_id
  left join lateral (
    -- The domain the company is DISPLAYED by (logo, company page link),
    -- verified first, then the directory's most confident hint. `verified`
    -- rides along so callers can still tell a proof from a known name.
    select d.domain, d.verified
    from public.company_domains as d
    where d.company_id = c.id
    order by d.verified desc,
             public.company_confidence_rank(d.evidence_confidence) desc,
             d.created_at asc,
             d.domain asc
    limit 1
  ) as domain_row on true
  where dp.user_id = p_user_id
  limit 1;
$$;

comment on function public.get_user_company(uuid) is
  'The company a member displays on their profile: the display domain (verified when one exists, else the directory hint) and the member''s own verified membership flag.';

-- ─── The jobs payload's company ─────────────────────────────

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
