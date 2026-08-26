-- Remove generated profile pictures and make uploaded profile pictures optional.
-- Run this migration before deploying the matching application changes.

update public.designer_profiles
set avatar_url = null,
    avatar_source = null
where avatar_source is distinct from 'upload'
   or avatar_url ~* '^boring://'
   or avatar_url ~* '^https://([^/]+\.)?(dicebear\.com|robohash\.org|avataaars\.io|multiavatar\.com)/'
   or avatar_url ~* '^https://source\.boringavatars\.com/';

alter table public.designer_profiles
  drop constraint if exists designer_profiles_avatar_source_check;

alter table public.designer_profiles
  add constraint designer_profiles_avatar_source_check
  check (avatar_source is null or avatar_source = 'upload');

create or replace function public.complete_signup(
  p_name text,
  p_email text,
  p_password_hash text,
  p_company_id uuid,
  p_city_id uuid,
  p_sector_id uuid,
  p_experience_level text,
  p_interest_ids uuid[],
  p_avatar_url text,
  p_avatar_source text,
  p_invitation_token text default null
)
returns table (user_id uuid, application_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application_id uuid;
  v_user_id uuid;
begin
  if nullif(btrim(p_name), '') is null
     or nullif(btrim(p_email), '') is null
     or nullif(p_password_hash, '') is null
     or nullif(p_experience_level, '') is null
     or (p_avatar_url is null) <> (p_avatar_source is null)
     or (p_avatar_source is not null and p_avatar_source <> 'upload') then
    raise exception using errcode = '22023', message = 'invalid_signup_payload';
  end if;

  if p_invitation_token is not null then
    select i.application_id
      into v_application_id
      from public.invitations as i
     where i.token = p_invitation_token
       and i.used_at is null
       and i.expires_at >= now()
     for update;

    if v_application_id is null then
      raise exception using errcode = 'P0001', message = 'invitation_unavailable';
    end if;

    if exists (
      select 1 from public.users as u
       where u.application_id = v_application_id
    ) then
      raise exception using errcode = '23505', message = 'application_already_registered';
    end if;
  end if;

  if exists (select 1 from public.users as u where lower(u.email) = lower(p_email)) then
    raise exception using errcode = '23505', message = 'email_already_registered';
  end if;

  if not exists (select 1 from public.companies as c where c.id = p_company_id and c.is_active)
     or not exists (select 1 from public.cities as c where c.id = p_city_id and c.is_active)
     or not exists (select 1 from public.design_sectors as s where s.id = p_sector_id and s.is_active)
     or not exists (select 1 from public.experience_levels as e where e.slug = p_experience_level and e.is_active) then
    raise exception using errcode = '23503', message = 'inactive_or_missing_profile_option';
  end if;

  if exists (
    select 1
      from unnest(coalesce(p_interest_ids, array[]::uuid[])) as requested(id)
      left join public.design_interests as interest
        on interest.id = requested.id and interest.is_active
     where interest.id is null
  ) then
    raise exception using errcode = '23503', message = 'inactive_or_missing_interest';
  end if;

  insert into public.users (application_id, name, email, password_hash)
  values (v_application_id, btrim(p_name), lower(btrim(p_email)), p_password_hash)
  returning id into v_user_id;

  insert into public.designer_profiles (
    user_id,
    company_id,
    city_id,
    sector_id,
    experience_level,
    avatar_url,
    avatar_source
  ) values (
    v_user_id,
    p_company_id,
    p_city_id,
    p_sector_id,
    p_experience_level,
    p_avatar_url,
    p_avatar_source
  );

  insert into public.user_interests (user_id, interest_id)
  select v_user_id, requested.id
    from (
      select distinct id
        from unnest(coalesce(p_interest_ids, array[]::uuid[])) as selected(id)
    ) as requested;

  if v_application_id is not null then
    update public.invitations
       set used_at = now()
     where token = p_invitation_token
       and application_id = v_application_id
       and used_at is null;

    if not found then
      raise exception using errcode = 'P0001', message = 'invitation_unavailable';
    end if;
  end if;

  return query select v_user_id, v_application_id;
end;
$$;

revoke all on function public.complete_signup(
  text, text, text, uuid, uuid, uuid, text, uuid[], text, text, text
) from public, anon, authenticated;

grant execute on function public.complete_signup(
  text, text, text, uuid, uuid, uuid, text, uuid[], text, text, text
) to service_role;
