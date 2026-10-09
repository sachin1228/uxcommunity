-- ============================================================
-- The poster's company on the jobs payload
--
-- WHY
--   The "Posted by" card says who posted a role; their profile says
--   where they work. The payload carried no company for the poster —
--   only the posting's own company, which is not the same thing: a
--   hiring post is made under a verified company that may differ from
--   the company the poster displays on their profile.
--
-- WHAT
--   `job_post_payload`'s poster object gains `company_name`: the
--   company on the poster's profile (designer_profiles.company_id),
--   the same row the profile chip shows. Null when the profile has no
--   company. Display-only; nothing is gated on it.
--
-- Deploy note: create-or-replace of one existing function only; no
-- schema change. Apply after 20261009140000_company_display_domain.sql.
-- ============================================================

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
      'experience_level_label', pel.name,
      -- Where the poster works, the same company their profile shows.
      'company_name', pc.name
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
