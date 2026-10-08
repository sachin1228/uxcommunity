-- ============================================================
-- Retire the platform "General" community
--
-- Signup used to seed one default General group and auto-join every
-- member to it. That community is being deleted outright — members
-- are no longer put in it at signup or by the dashboard repair — so
-- this migration removes the row (and everything hanging off it:
-- memberships, messages, rules, invites, …) and the 'general' type
-- from the schema, so the retired community cannot reappear.
--
-- The profile-derived groups (city, sector, experience level, job
-- title, interests) are untouched; auto-join only loses its General
-- step.
-- ============================================================

-- ─── 1. Delete the community and its data ────────────────────
-- Every child table (community_members, community_messages,
-- community_rules, community_threads, community_events, …)
-- references communities(id) on delete cascade, so one delete takes
-- the whole record with it. Filter by type, not name: a member-led
-- community called "General" is a different community.
delete from public.communities
 where type = 'general';

-- ─── 2. The singleton index has nothing left to guard ────────
drop index if exists public.idx_communities_general_singleton;

-- ─── 3. 'general' is no longer a community type ──────────────
alter table public.communities
  drop constraint if exists communities_type_check;

alter table public.communities
  add constraint communities_type_check
  check (type in ('city', 'sector', 'interest', 'experience_level', 'job_title', 'user', 'event'));

-- ─── 4. Explore no longer treats 'general' as open to all ────
-- Definition copied from 20260927120000_community_member_count.sql
-- (the current one), with 'general' dropped from the can_join branch.
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
      el.id as experience_level_id,
      jt.id as job_title_id
    from public.designer_profiles as dp
    left join public.experience_levels as el
      on el.slug = dp.experience_level::text
    left join public.job_titles as jt
      on jt.slug = dp.job_title::text
    where dp.user_id = p_user_id
    limit 1
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
        when 'job_title' then job.image_url
      end,
      c.image_url
    ) as image_url,
    coalesce(
      case c.type
        when 'city' then city.lottie_url
        when 'sector' then sector.lottie_url
        when 'interest' then interest.lottie_url
        when 'experience_level' then experience.lottie_url
        when 'job_title' then job.lottie_url
      end,
      c.lottie_url
    ) as lottie_url,
    coalesce(
      case c.type
        when 'city' then city.lottie_format
        when 'sector' then sector.lottie_format
        when 'interest' then interest.lottie_format
        when 'experience_level' then experience.lottie_format
        when 'job_title' then job.lottie_format
      end,
      c.lottie_format
    ) as lottie_format,
    c.description,
    coalesce(c.is_private, false) as is_private,
    -- The materialized counter (20260927120000_community_member_count.sql):
    -- the Explore directory used to aggregate the whole membership table here.
    c.member_count::bigint,
    -- "joined" is a membership existence test for the caller only, answered by
    -- the (community_id, user_id) primary key — one index probe per community.
    exists (
      select 1
      from public.community_members cm
      where cm.community_id = c.id
        and cm.user_id = p_user_id
    ) as joined,
    case
      when c.type in ('interest', 'user') then true
      when c.type = 'sector' then profile.sector_id = c.reference_id
      when c.type = 'city' then profile.city_id = c.reference_id
      when c.type = 'experience_level' then profile.experience_level_id = c.reference_id
      when c.type = 'job_title' then profile.job_title_id = c.reference_id
      else false
    end as can_join
  from public.communities as c
  left join profile on true
  left join public.cities as city
    on c.type = 'city' and city.id = c.reference_id
  left join public.design_sectors as sector
    on c.type = 'sector' and sector.id = c.reference_id
  left join public.design_interests as interest
    on c.type = 'interest' and interest.id = c.reference_id
  left join public.experience_levels as experience
    on c.type = 'experience_level' and experience.id = c.reference_id
  left join public.job_titles as job
    on c.type = 'job_title' and job.id = c.reference_id
  where c.is_active = true
    -- An empty community is not a directory entry: this keeps the row the
    -- old INNER JOIN to the membership aggregate used to drop, without
    -- aggregating anything.
    and c.member_count > 0
    -- Event group chats are an event's room, not a community to browse.
    and c.type <> 'event'
    and case c.type
      when 'city' then city.id is not null
      when 'sector' then sector.id is not null
      when 'interest' then interest.id is not null
      when 'experience_level' then experience.id is not null
      when 'job_title' then job.id is not null
      else true
    end
  order by c.name;
$$;

comment on function public.get_all_communities(uuid) is
  'Returns the response-ready active community explore list in one query (event group chats excluded). member_count is read from communities.member_count rather than aggregated from community_members.';

revoke all on function public.get_all_communities(uuid) from public, anon, authenticated;
grant execute on function public.get_all_communities(uuid) to service_role;
