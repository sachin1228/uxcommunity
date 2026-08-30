-- Add has_pending_request to get_all_communities RPC
-- This ensures the explore page knows if a user has a pending join request for private communities

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
  can_join boolean,
  has_pending_request boolean
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
  ),
  pending_requests as (
    select
      cj.community_id,
      bool_or(cj.status = 'pending') as has_pending_request
    from public.community_join_requests as cj
    where cj.user_id = p_user_id
    group by cj.community_id
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
    end as can_join,
    coalesce(pr.has_pending_request, false) as has_pending_request
  from public.communities as c
  join membership_aggregates as members on members.community_id = c.id
  left join profile on true
  left join pending_requests as pr on pr.community_id = c.id
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
