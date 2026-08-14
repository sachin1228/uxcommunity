-- Remove the request-time full-table membership aggregation from get_all_communities.
-- Counts are maintained on the parent row, while a user-first covering index resolves joined.

alter table public.communities
  add column if not exists member_count bigint not null default 0;

update public.communities as community
set member_count = counts.member_count
from (
  select community_id, count(*)::bigint as member_count
  from public.community_members
  group by community_id
) as counts
where community.id = counts.community_id;

update public.communities as community
set member_count = 0
where not exists (
  select 1
  from public.community_members as member
  where member.community_id = community.id
);

alter table public.communities
  drop constraint if exists communities_member_count_nonnegative;

alter table public.communities
  add constraint communities_member_count_nonnegative
  check (member_count >= 0);

create or replace function public.update_community_member_count()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.communities
    set member_count = member_count + 1
    where id = new.community_id;
    return new;
  end if;

  update public.communities
  set member_count = greatest(member_count - 1, 0)
  where id = old.community_id;
  return old;
end;
$$;

revoke all on function public.update_community_member_count() from public, anon, authenticated;

drop trigger if exists community_members_increment_count on public.community_members;

create trigger community_members_increment_count
  after insert on public.community_members
  for each row
  execute function public.update_community_member_count();

drop trigger if exists community_members_decrement_count on public.community_members;

create trigger community_members_decrement_count
  after delete on public.community_members
  for each row
  execute function public.update_community_member_count();

drop index if exists public.idx_community_members_user;

create index if not exists idx_community_members_user_community
  on public.community_members (user_id, community_id);

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
      dp.company_id,
      el.id as experience_level_id
    from public.designer_profiles as dp
    left join public.experience_levels as el
      on el.slug = dp.experience_level::text
    where dp.user_id = p_user_id
    limit 1
  ),
  user_memberships as (
    select cm.community_id
    from public.community_members as cm
    where cm.user_id = p_user_id
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
        when 'company' then company.image_url
        when 'experience_level' then experience.image_url
      end,
      c.image_url
    ) as image_url,
    c.description,
    coalesce(c.is_private, false) as is_private,
    c.member_count,
    membership.community_id is not null as joined,
    case
      when c.type in ('interest', 'general', 'user') then true
      when c.type = 'company' then profile.company_id = c.reference_id
      when c.type = 'sector' then profile.sector_id = c.reference_id
      when c.type = 'city' then profile.city_id = c.reference_id
      when c.type = 'experience_level' then profile.experience_level_id = c.reference_id
      else false
    end as can_join
  from public.communities as c
  left join user_memberships as membership
    on membership.community_id = c.id
  left join profile on true
  left join public.cities as city
    on c.type = 'city' and city.id = c.reference_id
  left join public.design_sectors as sector
    on c.type = 'sector' and sector.id = c.reference_id
  left join public.design_interests as interest
    on c.type = 'interest' and interest.id = c.reference_id
  left join public.companies as company
    on c.type = 'company' and company.id = c.reference_id
  left join public.experience_levels as experience
    on c.type = 'experience_level' and experience.id = c.reference_id
  where c.is_active = true
    and c.member_count > 0
    and case c.type
      when 'city' then city.id is not null
      when 'sector' then sector.id is not null
      when 'interest' then interest.id is not null
      when 'company' then company.id is not null
      when 'experience_level' then experience.id is not null
      else true
    end
  order by c.name;
$$;

comment on function public.get_all_communities(uuid) is
  'Returns the response-ready active community explore list without request-time membership aggregation.';

revoke all on function public.get_all_communities(uuid) from public, anon, authenticated;
grant execute on function public.get_all_communities(uuid) to service_role;

-- Production verification after deployment (replace the UUID with a representative user):
-- explain (analyze, buffers, settings, verbose)
-- select * from public.get_all_communities('00000000-0000-0000-0000-000000000000');
