-- ============================================================
-- Attach a private resume in the same transaction as the application
--
-- The route used to call apply_to_job, then UPDATE job_applications.resume_key
-- in a second request. A failure there left an application with no resume and
-- an orphaned private object. This wrapper runs the existing eligibility/insert
-- function and the key attachment in one database transaction.
-- ============================================================

create or replace function public.apply_to_job_with_resume(
  p_job_id uuid,
  p_applicant_id uuid,
  p_name text,
  p_portfolio_url text,
  p_linkedin_url text,
  p_resume_key text
)
returns table (application_id uuid, created_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application_id uuid;
  v_created_at timestamptz;
  v_updated integer;
begin
  if p_resume_key is null
     or p_resume_key not like 'resumes/%'
     or p_resume_key like '%..%'
     or p_resume_key like 'http%' then
    raise exception using errcode = '22023', message = 'invalid_resume_key';
  end if;

  select a.application_id, a.created_at
    into v_application_id, v_created_at
    from public.apply_to_job(
      p_job_id,
      p_applicant_id,
      p_name,
      p_portfolio_url,
      p_linkedin_url,
      null
    ) as a
   limit 1;

  if v_application_id is null then
    raise exception using errcode = 'P0001', message = 'application_not_created';
  end if;

  update public.job_applications
     set resume_key = p_resume_key
   where id = v_application_id
     and applicant_id = p_applicant_id;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception using errcode = 'P0001', message = 'resume_key_not_attached';
  end if;

  return query select v_application_id, v_created_at;
end;
$$;

comment on function public.apply_to_job_with_resume(
  uuid, uuid, text, text, text, text
) is
  'Creates a job application and attaches its private resume key in one transaction.';

revoke all on function public.apply_to_job_with_resume(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_to_job_with_resume(uuid, uuid, text, text, text, text)
  to service_role;

notify pgrst, 'reload schema';
