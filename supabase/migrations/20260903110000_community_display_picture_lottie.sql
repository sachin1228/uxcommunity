-- ============================================================
-- Community display picture: Lottie animations
--
-- A community's display picture can now be a Lottie animation
-- (.lottie or .json) in addition to a static image. The lottie
-- URL + format are stored on the communities row AND mirrored
-- onto the linked master-data row (city / sector / interest /
-- experience level) when the admin replaces the DP, so the
-- animated DP propagates everywhere the app resolves master
-- images.
--
-- lottie_format: 'json' (Lottie JSON) | 'dotlottie' (.lottie)
-- ============================================================

alter table public.communities
  add column if not exists lottie_url text,
  add column if not exists lottie_format text
    check (lottie_format is null or lottie_format in ('json', 'dotlottie'));

alter table public.cities
  add column if not exists lottie_url text,
  add column if not exists lottie_format text
    check (lottie_format is null or lottie_format in ('json', 'dotlottie'));

alter table public.design_sectors
  add column if not exists lottie_url text,
  add column if not exists lottie_format text
    check (lottie_format is null or lottie_format in ('json', 'dotlottie'));

alter table public.design_interests
  add column if not exists lottie_url text,
  add column if not exists lottie_format text
    check (lottie_format is null or lottie_format in ('json', 'dotlottie'));

alter table public.experience_levels
  add column if not exists lottie_url text,
  add column if not exists lottie_format text
    check (lottie_format is null or lottie_format in ('json', 'dotlottie'));

-- Explore-communities RPC: include the lottie DP so dashboard cards can
-- render the animated display picture too.
create or replace function public.get_all_communities(p_user_id uuid)
returns table (
  id uuid,
  name text,
  type text,
  image_url text,
  lottie_url text,
  lottie_format text,
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
        when 'company' then company.image_url
        when 'experience_level' then experience.image_url
      end,
      c.image_url
    ) as image_url,
    coalesce(
      case c.type
        when 'city' then city.lottie_url
        when 'sector' then sector.lottie_url
        when 'interest' then interest.lottie_url
        when 'company' then company.lottie_url
        when 'experience_level' then experience.lottie_url
      end,
      c.lottie_url
    ) as lottie_url,
    coalesce(
      case c.type
        when 'city' then city.lottie_format
        when 'sector' then sector.lottie_format
        when 'interest' then interest.lottie_format
        when 'company' then company.lottie_format
        when 'experience_level' then experience.lottie_format
      end,
      c.lottie_format
    ) as lottie_format,
    c.description,
    coalesce(c.is_private, false) as is_private,
    members.member_count,
    members.joined,
    case
      when c.type in ('interest', 'general', 'user') then true
      when c.type = 'company' then profile.company_id = c.reference_id
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
  left join public.companies as company
    on c.type = 'company' and company.id = c.reference_id
  left join public.experience_levels as experience
    on c.type = 'experience_level' and experience.id = c.reference_id
  where c.is_active = true
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