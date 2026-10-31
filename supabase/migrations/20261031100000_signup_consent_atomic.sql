-- ============================================================
-- Atomic signup consent
--
-- `complete_signup` creates the users + designer_profiles rows. The web route
-- used to write age_confirmed_at / terms_accepted_at in a second, best-effort
-- update after that call, so an account could exist with no durable consent
-- record if that update failed. This wrapper writes both timestamps inside the
-- same database transaction and refuses to create an account unless both
-- acknowledgements are true.
--
-- `terms_version` records which published policy the member accepted. Existing
-- accounts keep NULL; consent is never back-dated. A re-consent flow for those
-- accounts is a product/data decision, documented separately.
-- ============================================================

alter table public.users
  add column if not exists terms_version text;

comment on column public.users.terms_version is
  'Published Terms/Privacy version accepted at signup. NULL for accounts created before versioned consent or not yet re-consented.';

create or replace function public.complete_signup_with_consent(
  p_name text,
  p_email text,
  p_password_hash text,
  p_city_id uuid,
  p_sector_id uuid,
  p_experience_level text,
  p_job_title text,
  p_avatar_url text,
  p_avatar_source text,
  p_age_confirmed boolean,
  p_terms_accepted boolean,
  p_terms_version text,
  p_invitation_token text default null
)
returns table (user_id uuid, application_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_application_id uuid;
  v_updated integer;
begin
  if p_age_confirmed is not true or p_terms_accepted is not true then
    raise exception using errcode = 'P0001', message = 'consent_required';
  end if;

  if nullif(btrim(p_terms_version), '') is null then
    raise exception using errcode = '22023', message = 'consent_version_required';
  end if;

  -- The inner function is SECURITY DEFINER and owns the account/profile
  -- inserts. Calling it from this function keeps those inserts and the consent
  -- write in one transaction: any failure rolls the whole signup back.
  select c.user_id, c.application_id
    into v_user_id, v_application_id
    from public.complete_signup(
      p_name,
      p_email,
      p_password_hash,
      p_city_id,
      p_sector_id,
      p_experience_level,
      p_job_title,
      p_avatar_url,
      p_avatar_source,
      p_invitation_token
    ) as c
   limit 1;

  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'signup_not_created';
  end if;

  update public.users
     set age_confirmed_at = now(),
         terms_accepted_at = now(),
         terms_version = btrim(p_terms_version),
         updated_at = now()
   where id = v_user_id;

  get diagnostics v_updated = row_count;
  if v_updated <> 1 then
    raise exception using errcode = 'P0001', message = 'consent_not_recorded';
  end if;

  return query select v_user_id, v_application_id;
end;
$$;

comment on function public.complete_signup_with_consent(
  text, text, text, uuid, uuid, text, text, text, text, boolean, boolean, text, text
) is
  'Creates an account and records age/Terms consent in the same transaction. Refuses false consent flags.';

revoke all on function public.complete_signup_with_consent(
  text, text, text, uuid, uuid, text, text, text, text, boolean, boolean, text, text
) from public, anon, authenticated;

grant execute on function public.complete_signup_with_consent(
  text, text, text, uuid, uuid, text, text, text, text, boolean, boolean, text, text
) to service_role;

notify pgrst, 'reload schema';
