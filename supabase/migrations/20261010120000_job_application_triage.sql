-- ============================================================
-- Jobs — triaging applications (new / shortlisted / rejected)
--
-- WHY
--   The applicants board was read-only: a poster could see who
--   applied and nothing else, so the list never answered "who am
--   I following up with?". One column and one write close that
--   gap, deliberately minimal because triage is a personal mark,
--   not a workflow:
--
--     • three states, freely movable in any direction — a
--       rejection is a decision, not a deletion, and moving an
--       applicant back to 'new' is the same write as any other;
--     • no timestamp of its own — the decision is a current
--       standing, and job_applications.created_at stays the only
--       moment the record carries.
--
-- WHAT
--   • job_applications gains `status` ('new' | 'shortlisted' |
--     'rejected', default 'new'). Defaulted, so every existing
--     row reads as untriaged without a backfill.
--   • set_job_application_status — the write. Poster-only,
--     re-checked inside the database through the application's
--     own job, the way set_job_post_status re-checks
--     job_posts.poster_id; the API route only passes the session
--     user id.
--   • get_job_applicants is recreated to carry `status`, so the
--     board renders the decision it already stored.
--
-- Deploy note: additive schema (one defaulted column) and
-- create-or-replace of one read; one new function. No backfill.
-- Apply after 20261009190000_job_description_formatting.sql.
-- ============================================================

-- ─── The triage column ──────────────────────────────────────

alter table public.job_applications
  add column if not exists status text not null default 'new'
    check (status in ('new', 'shortlisted', 'rejected'));

-- ─── Setting an application's status ────────────────────────

create or replace function public.set_job_application_status(
  p_actor_id       uuid,
  p_application_id uuid,
  p_status         text
)
returns table (application_id uuid, application_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := btrim(coalesce(p_status, ''));
begin
  if v_status not in ('new', 'shortlisted', 'rejected') then
    raise exception using errcode = '22023', message = 'invalid_status';
  end if;

  -- Owner-scoped through the application's own job, in one statement,
  -- so the check and the change are one write: nobody can win a race
  -- between them.
  return query
  with updated as (
    update public.job_applications as ja
       set status = v_status
     where ja.id = p_application_id
       and exists (
         select 1 from public.job_posts as jp
         where jp.id = ja.job_id and jp.poster_id = p_actor_id
       )
    returning ja.id, ja.status
  )
  select updated.id, updated.status from updated;

  -- Say which refusal it was: the application is gone, or its posting
  -- is not this actor's.
  if not found then
    if exists (
      select 1 from public.job_applications as ja where ja.id = p_application_id
    ) then
      raise exception using errcode = 'P0001', message = 'not_your_job';
    end if;
    raise exception using errcode = 'P0002', message = 'application_not_found';
  end if;
end;
$$;

-- ─── Reads: the applicants board carries the triage ─────────
-- Create-or-replace of the 20261009120000_jobs.sql definition
-- with `status` added.

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
    'avatar_url', dp.avatar_url,
    'status', ja.status
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
-- may call this.

revoke all on function public.set_job_application_status(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.set_job_application_status(uuid, uuid, text)
  to service_role;
