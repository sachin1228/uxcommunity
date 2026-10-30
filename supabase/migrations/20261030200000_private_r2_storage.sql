-- ============================================================
-- Private R2 storage: keys for résumés, verification samples and DM images
--
-- Today every file lives in the public media bucket and the database holds a
-- permanent, publicly fetchable URL. Resumes and verification samples are PII;
-- DM images are private conversation content. This migration adds an object-key
-- column beside each legacy URL column:
--
--   * new writes store the key of an object in R2_PRIVATE_BUCKET_NAME (a bucket
--     with public access disabled) and leave the legacy URL column NULL;
--   * reads keep working for un-migrated rows through the old URL column;
--   * the migration script (scripts/migrate-private-r2.mjs) moves existing
--     objects and fills the key columns without touching the legacy URLs;
--   * the legacy URL columns can be cleared only after the migration is
--     verified and the public copies are gone.
--
-- RLS is unchanged: every table here is service-role only, and the app
-- authorizes each download before signing a short-lived URL.
-- ============================================================

-- ─── member_resumes ─────────────────────────────────────────
alter table public.member_resumes
  add column if not exists storage_key text;

-- New rows are key-backed and carry no public URL. The legacy column stays
-- populated for rows written before the migration.
alter table public.member_resumes alter column url drop not null;

alter table public.member_resumes
  drop constraint if exists member_resumes_location_present;
alter table public.member_resumes
  add constraint member_resumes_location_present
  check (url is not null or storage_key is not null);

alter table public.member_resumes
  drop constraint if exists member_resumes_storage_key_shape;
alter table public.member_resumes
  add constraint member_resumes_storage_key_shape check (
    storage_key is null
    or (
      storage_key like 'resumes/%'
      and storage_key not like '%..%'
      and storage_key not like 'http%'
    )
  );

comment on column public.member_resumes.storage_key is
  'Object key in the private R2 bucket. Takes precedence over url; url is the legacy public copy.';

-- ─── job_applications ──────────────────────────────────────
alter table public.job_applications
  add column if not exists resume_key text;

alter table public.job_applications
  drop constraint if exists job_applications_resume_key_shape;
alter table public.job_applications
  add constraint job_applications_resume_key_shape check (
    resume_key is null
    or (
      resume_key like 'resumes/%'
      and resume_key not like '%..%'
      and resume_key not like 'http%'
    )
  );

comment on column public.job_applications.resume_key is
  'Object key in the private R2 bucket. Takes precedence over the legacy resume_url.';

-- ─── account_verification_requests ─────────────────────────
alter table public.account_verification_requests
  add column if not exists work_sample_keys text[] not null default '{}';

alter table public.account_verification_requests
  drop constraint if exists account_verification_requests_sample_keys_len;
alter table public.account_verification_requests
  add constraint account_verification_requests_sample_keys_len
  check (cardinality(work_sample_keys) <= 3);

alter table public.account_verification_requests
  drop constraint if exists account_verification_requests_sample_keys_shape;
alter table public.account_verification_requests
  add constraint account_verification_requests_sample_keys_shape check (
    array_to_string(work_sample_keys, ',') not like 'http%'
    and array_to_string(work_sample_keys, ',') not like '%..%'
  );

comment on column public.account_verification_requests.work_sample_keys is
  'Private R2 object keys, parallel to work_sample_urls. New submissions fill this and leave work_sample_urls empty.';

-- ─── dm_messages ───────────────────────────────────────────
alter table public.dm_messages
  add column if not exists image_key text;

alter table public.dm_messages
  drop constraint if exists dm_messages_image_key_shape;
alter table public.dm_messages
  add constraint dm_messages_image_key_shape check (
    image_key is null
    or (
      image_key like 'dm/%'
      and image_key not like '%..%'
      and image_key not like 'http%'
    )
  );

-- A row is still required to carry something visible unless it is a tombstone.
-- The private key counts as the image payload; image_url then holds the
-- authorization-gated proxy path the clients render (never a public URL).
alter table public.dm_messages
  drop constraint if exists dm_messages_payload_present;
alter table public.dm_messages
  add constraint dm_messages_payload_present check (
    deleted_at is not null
    or image_url is not null
    or image_key is not null
    or content is not null
  );

comment on column public.dm_messages.image_key is
  'Object key in the private R2 bucket. image_url is the stable /api/private/dm/… path clients render.';

-- ─── Read payloads: expose the private keys ────────────────
-- The public URL remains in the payload for rows that have not been migrated;
-- the API maps key-backed rows to an authorization-gated path (web) or a
-- short-lived signed URL (mobile).

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
    'city_name', coalesce(ci.name, 'All cities'),
    'sector_id', jp.sector_id,
    'sector_name', coalesce(se.name, 'All sectors'),
    'job_title', jp.job_title,
    'job_title_label', coalesce(jt.name, jp.job_title),
    'experience_level', jp.experience_level,
    'experience_level_label', coalesce(el.name, jp.experience_level),
    'created_at', jp.created_at,
    'status', jp.status,
    'updated_at', jp.updated_at,
    'closes_at', jp.closes_at,
    'company', jsonb_build_object(
      'id', co.id,
      'name', co.name,
      'slug', co.slug,
      'logo_url', co.logo_url,
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
      'company_name', pc.name
    ),
    'applicant_count', (
      select count(*) from public.job_applications as ja where ja.job_id = jp.id
    ),
    'criteria_locked', exists (
      select 1 from public.job_applications as ja where ja.job_id = jp.id
    ),
    'applied', exists (
      select 1 from public.job_applications as ja
      where ja.job_id = jp.id and ja.applicant_id = p_viewer_id
    ),
    'is_mine', jp.poster_id = p_viewer_id,
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
          and (jp.city_id is null or vp.city_id = jp.city_id)
          and (jp.sector_id is null or vp.sector_id = jp.sector_id)
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
      'resume_key', ja.resume_key,
      'created_at', ja.created_at
    ) as application
    from public.job_applications as ja
    where ja.job_id = jp.id and ja.applicant_id = p_viewer_id
  ) as ma on true
  where jp.id = p_job_id;
$$;

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
    'resume_key', ja.resume_key,
    'created_at', ja.created_at,
    'avatar_url', dp.avatar_url,
    'status', ja.status
  )
  from public.job_applications as ja
  left join public.designer_profiles as dp on dp.user_id = ja.applicant_id
  where ja.job_id = p_job_id
  order by ja.created_at desc, ja.id desc;
end;
$$;

-- Grants: signatures are unchanged, so the existing revoke/grant set remains.
