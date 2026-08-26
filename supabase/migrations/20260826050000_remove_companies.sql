-- Permanently remove companies and company communities.
-- This intentionally deletes every community whose type is `company`.
-- Child records are removed by the existing ON DELETE CASCADE foreign keys.

begin;

-- Remove company communities before removing the company lookup data.
delete from public.communities where type = 'company';

-- Remove the old RPC signature before dropping its company dependency.
drop function if exists public.complete_signup(
  text, text, text, uuid, uuid, uuid, text, uuid[], text, text, text
);

create function public.complete_signup(
  p_name text,
  p_email text,
  p_password_hash text,
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
    select i.application_id into v_application_id
    from public.invitations as i
    where i.token = p_invitation_token
      and i.used_at is null
      and i.expires_at >= now()
    for update;

    if v_application_id is null then
      raise exception using errcode = 'P0001', message = 'invitation_unavailable';
    end if;

    if exists (select 1 from public.users as u where u.application_id = v_application_id) then
      raise exception using errcode = '23505', message = 'application_already_registered';
    end if;
  end if;

  if exists (select 1 from public.users as u where lower(u.email) = lower(p_email)) then
    raise exception using errcode = '23505', message = 'email_already_registered';
  end if;

  if not exists (select 1 from public.cities as c where c.id = p_city_id and c.is_active)
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
    user_id, city_id, sector_id, experience_level, avatar_url, avatar_source
  ) values (
    v_user_id, p_city_id, p_sector_id, p_experience_level, p_avatar_url, p_avatar_source
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
  text, text, text, uuid, uuid, text, uuid[], text, text, text
) from public, anon, authenticated;
grant execute on function public.complete_signup(
  text, text, text, uuid, uuid, text, uuid[], text, text, text
) to service_role;

create or replace function public.get_all_communities(p_user_id uuid)
returns table (
  id uuid, name text, type text, image_url text, description text,
  is_private boolean, member_count bigint, joined boolean, can_join boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with profile as (
    select dp.city_id, dp.sector_id, el.id as experience_level_id
    from public.designer_profiles as dp
    left join public.experience_levels as el on el.slug = dp.experience_level::text
    where dp.user_id = p_user_id
    limit 1
  ), membership_aggregates as (
    select cm.community_id, count(*) as member_count,
      bool_or(cm.user_id = p_user_id) as joined
    from public.community_members as cm
    group by cm.community_id
  )
  select c.id, c.name, c.type,
    coalesce(case c.type
      when 'city' then city.image_url
      when 'sector' then sector.image_url
      when 'interest' then interest.image_url
      when 'experience_level' then experience.image_url
    end, c.image_url) as image_url,
    c.description, coalesce(c.is_private, false), members.member_count, members.joined,
    case
      when c.type in ('interest', 'general', 'user') then true
      when c.type = 'sector' then profile.sector_id = c.reference_id
      when c.type = 'city' then profile.city_id = c.reference_id
      when c.type = 'experience_level' then profile.experience_level_id = c.reference_id
      else false
    end as can_join
  from public.communities as c
  join membership_aggregates as members on members.community_id = c.id
  left join profile on true
  left join public.cities as city on c.type = 'city' and city.id = c.reference_id
  left join public.design_sectors as sector on c.type = 'sector' and sector.id = c.reference_id
  left join public.design_interests as interest on c.type = 'interest' and interest.id = c.reference_id
  left join public.experience_levels as experience on c.type = 'experience_level' and experience.id = c.reference_id
  where c.is_active = true
    and case c.type
      when 'city' then city.id is not null
      when 'sector' then sector.id is not null
      when 'interest' then interest.id is not null
      when 'experience_level' then experience.id is not null
      else true
    end
  order by c.name;
$$;

revoke all on function public.get_all_communities(uuid) from public, anon, authenticated;
grant execute on function public.get_all_communities(uuid) to service_role;

alter table public.designer_profiles
  drop constraint if exists designer_profiles_company_id_fkey;
drop index if exists public.idx_designer_profiles_company;
alter table public.designer_profiles drop column if exists company_id;

alter table public.communities drop constraint if exists communities_type_check;
alter table public.communities add constraint communities_type_check
  check (type in ('city', 'sector', 'interest', 'experience_level', 'general', 'user'));

drop table if exists public.companies cascade;

commit;
