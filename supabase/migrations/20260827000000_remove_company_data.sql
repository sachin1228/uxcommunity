-- Remove the company profile dimension and every company-generated community.
-- Company communities are deleted before the type constraint is tightened;
-- their dependent members, messages, threads, events, resources, showcase
-- items, comments, likes, saves, rules, and join requests follow their
-- community foreign keys with ON DELETE CASCADE.

-- Replace database functions that previously depended on companies or the
-- designer_profiles.company_id column before removing those database objects.
drop function if exists public.get_community_message_page(
  uuid, uuid, timestamptz, timestamptz, timestamptz, integer
);

create or replace function public.get_community_message_page(
  p_community_id uuid,
  p_user_id uuid,
  p_history_start timestamptz,
  p_before timestamptz default null,
  p_after timestamptz default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  content text,
  created_at timestamptz,
  user_id uuid,
  reply_to_id uuid,
  image_url text,
  deleted_at timestamptz,
  users jsonb,
  reactions jsonb,
  reply_to jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with message_page as materialized (
    (
      select message.id, message.content, message.created_at, message.user_id,
        message.reply_to_id, message.image_url, message.deleted_at
      from public.community_messages as message
      where p_after is not null
        and message.community_id = p_community_id
        and message.created_at >= p_history_start
        and message.created_at > p_after
      order by message.created_at asc, message.id asc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    )
    union all
    (
      select message.id, message.content, message.created_at, message.user_id,
        message.reply_to_id, message.image_url, message.deleted_at
      from public.community_messages as message
      where p_after is null
        and message.community_id = p_community_id
        and message.created_at >= p_history_start
        and (p_before is null or message.created_at < p_before)
      order by message.created_at desc, message.id desc
      limit least(greatest(coalesce(p_limit, 50), 1), 100)
    )
  )
  select
    message.id, message.content, message.created_at, message.user_id,
    message.reply_to_id, message.image_url, message.deleted_at,
    case when author.id is null then null else jsonb_build_object(
      'name', author.name,
      'avatar_url', profile.avatar_url,
      'designation', case
        when experience.name is null then null
        when experience.name ~* '^heads\s+of\b' then regexp_replace(experience.name, '^heads', 'Head', 'i')
        else regexp_replace(split_part(experience.name, '(', 1), 's\s*$', '')
      end
    ) end as users,
    coalesce(reaction_groups.reactions, '[]'::jsonb) as reactions,
    case when reply.id is null then null else jsonb_build_object(
      'id', reply.id,
      'content', coalesce(reply.content, ''),
      'user_name', coalesce(reply_author.name, 'Unknown')
    ) end as reply_to
  from message_page as message
  left join public.users as author on author.id = message.user_id
  left join public.designer_profiles as profile on profile.user_id = message.user_id
  left join public.experience_levels as experience on experience.slug = profile.experience_level::text
  left join public.community_messages as reply on reply.id = message.reply_to_id
  left join public.users as reply_author on reply_author.id = reply.user_id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('emoji', grouped.emoji, 'user_ids', grouped.user_ids)
      order by grouped.emoji
    ) as reactions
    from (
      select reaction.emoji, jsonb_agg(reaction.user_id order by reaction.user_id) as user_ids
      from public.message_reactions as reaction
      where reaction.message_id = message.id
      group by reaction.emoji
    ) as grouped
  ) as reaction_groups on true
  where p_user_id is not null
  order by message.created_at desc, message.id desc;
$$;

revoke all on function public.get_community_message_page(uuid, uuid, timestamptz, timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.get_community_message_page(uuid, uuid, timestamptz, timestamptz, timestamptz, integer) to service_role;

drop function if exists public.get_all_communities(uuid);

create or replace function public.get_all_communities(p_user_id uuid)
returns table (
  id uuid,
  name text,
  type text,
  image_url text,
  description text,
  is_private boolean,
  member_count bigint,
  joined boolean,
  can_join boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with profile as (
    select
      dp.city_id,
      dp.sector_id,
      el.id as experience_level_id
    from public.designer_profiles as dp
    left join public.experience_levels as el
      on el.slug = dp.experience_level::text
    where dp.user_id = p_user_id
    limit 1
  ),
  membership_aggregates as (
    select
      cm.community_id,
      count(*) as member_count,
      bool_or(cm.user_id = p_user_id) as joined
    from public.community_members as cm
    group by cm.community_id
  )
  select
    c.id,
    c.name,
    c.type,
    coalesce(
      case c.type
        when 'city' then city.image_url
        when 'sector' then sector.image_url
        when 'interest' then interest.image_url
        when 'experience_level' then experience.image_url
      end,
      c.image_url
    ) as image_url,
    c.description,
    coalesce(c.is_private, false) as is_private,
    members.member_count,
    members.joined,
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
  left join public.cities as city
    on c.type = 'city' and city.id = c.reference_id
  left join public.design_sectors as sector
    on c.type = 'sector' and sector.id = c.reference_id
  left join public.design_interests as interest
    on c.type = 'interest' and interest.id = c.reference_id
  left join public.experience_levels as experience
    on c.type = 'experience_level' and experience.id = c.reference_id
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

comment on function public.get_all_communities(uuid) is
  'Returns the response-ready active community explore list in one query.';

revoke all on function public.get_all_communities(uuid) from public, anon, authenticated;
grant execute on function public.get_all_communities(uuid) to service_role;

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
    user_id,
    city_id,
    sector_id,
    experience_level,
    avatar_url,
    avatar_source
  ) values (
    v_user_id,
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
  text, text, text, uuid, uuid, text, uuid[], text, text, text
) from public, anon, authenticated;

grant execute on function public.complete_signup(
  text, text, text, uuid, uuid, text, uuid[], text, text, text
) to service_role;

-- Remove persisted company-specific settings and communities. Community
-- foreign keys cascade all company-community content and memberships.
delete from public.lottie_settings
 where (scope = 'type' and scope_key = 'company')
    or (scope = 'community' and scope_key in (
      select id::text from public.communities where type = 'company'
    ));

delete from public.communities
 where type = 'company';

alter table public.communities
  drop constraint if exists communities_type_check;

alter table public.communities
  add constraint communities_type_check
  check (type in ('city', 'sector', 'interest', 'experience_level', 'general', 'user'));

drop index if exists public.idx_profiles_company;

alter table public.designer_profiles
  drop constraint if exists designer_profiles_company_id_fkey;

alter table public.designer_profiles
  drop column if exists company_id;

drop table if exists public.companies;
