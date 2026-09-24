-- ============================================================
-- Event group chats
--
-- Every event gets its own chat community so the people going can
-- talk about it in one place:
--
--   * communities.type gains 'event'. The row points at its event
--     through the new communities.event_id (unique), so one group
--     exists per event and deleting the event takes its group with
--     it (on delete cascade).
--   * The event creator owns the group (they are in it from the
--     moment the event exists); everyone else joins by confirming
--     they are going — the chat route already refuses non-members,
--     so the confirmation is the door.
--   * Existing events are backfilled so the feature works on
--     content that predates it.
--   * Event groups are joined from their event, never browsed, so
--     Explore keeps listing only communities meant for discovery.
-- ============================================================

-- ─── 1. 'event' becomes a community type ────────────────────
alter table public.communities
  drop constraint if exists communities_type_check;

alter table public.communities
  add constraint communities_type_check
  check (type in ('city', 'sector', 'interest', 'experience_level', 'job_title', 'general', 'user', 'event'));

-- ─── 2. Link a group to the event it chats about ────────────
alter table public.communities
  add column if not exists event_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'communities_event_id_fkey'
  ) then
    alter table public.communities
      add constraint communities_event_id_fkey
      foreign key (event_id) references public.community_events (id) on delete cascade;
  end if;
end $$;

-- One group per event. Partial so the thousands of rows without an event
-- (every other community type) don't collide on null.
create unique index if not exists idx_communities_event_id
  on public.communities (event_id)
  where event_id is not null;

-- ─── 3. Backfill: give every existing event its group ───────
insert into public.communities (
  name, description, type, reference_id, image_url,
  owner_id, is_private, event_id, enabled_tabs, is_active
)
select
  left(e.title, 80),
  'Group chat for this event — say hi to everyone going.',
  'event',
  null,
  e.cover_image_url,
  e.user_id,
  false,
  e.id,
  array['chat']::text[],
  true
from public.community_events as e
where not exists (
  select 1 from public.communities as c where c.event_id = e.id
);

-- The creator is in their own group from the start.
insert into public.community_members (community_id, user_id, role)
select c.id, c.owner_id, 'owner'
from public.communities as c
where c.type = 'event'
  and c.owner_id is not null
on conflict (community_id, user_id) do nothing;

-- ─── 4. Explore stays event-free ────────────────────────────
-- Event groups are reached from their event page (and the sidebar once
-- joined). Showing the raw list in Explore would offer groups nobody can
-- join from there (can_join is false for the type) and drag every event
-- ever created into the directory.
drop function if exists public.get_all_communities(uuid);

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
    members.member_count,
    members.joined,
    case
      when c.type in ('interest', 'general', 'user') then true
      when c.type = 'sector' then profile.sector_id = c.reference_id
      when c.type = 'city' then profile.city_id = c.reference_id
      when c.type = 'experience_level' then profile.experience_level_id = c.reference_id
      when c.type = 'job_title' then profile.job_title_id = c.reference_id
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
  left join public.job_titles as job
    on c.type = 'job_title' and job.id = c.reference_id
  where c.is_active = true
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
  'Returns the response-ready active community explore list in one query (event group chats excluded).';

revoke all on function public.get_all_communities(uuid) from public, anon, authenticated;
grant execute on function public.get_all_communities(uuid) to service_role;
