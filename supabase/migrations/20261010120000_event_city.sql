-- ============================================================
-- Event city + per-city public event listings
--
-- WHY
--   The new Events page (workspace nav) lists the public events of
--   the viewer's city. Events never carried a city — only a free-text
--   location — so this adds one: the host picks it in the event form
--   (defaulting to their own profile city), and the page filters on it.
--
-- WHAT
--   1. community_events.city_id — nullable. Events that predate the
--      column (and events whose host set no city) never appear on the
--      city page. FK to cities with set null — an event must not be
--      lost over a master-data change.
--   2. A partial index for the page's exact read shape: one city's
--      public events, ordered by event date.
--   3. get_city_event_list_page — the city-wide sibling of
--      get_event_list_page: same phase semantics (upcoming/past over
--      coalesce(end_date, event_date)), same keyset cursor, same card
--      projection, but no membership gate, and community attribution
--      added (a city page mixes communities, so every card names its
--      own).
--
-- Deploy note: the release that starts calling this must not go out
-- before this SQL is applied. Apply it from the SQL editor first.
-- ============================================================

-- ─── 1. The event's city ────────────────────────────────────
alter table public.community_events
  add column if not exists city_id uuid references public.cities (id) on delete set null;

comment on column public.community_events.city_id is
  'The city this event is listed under on the city Events page; picked by the host (defaults to their profile city). Null on events that predate this column — they never appear on the city page.';

-- ─── 2. The city page's read path ───────────────────────────
create index if not exists idx_community_events_city_public_date
  on public.community_events (city_id, event_date)
  where is_public;

-- ─── 3. The city page's page function ───────────────────────
create or replace function public.get_city_event_list_page(
  p_city_id uuid,
  p_user_id uuid,
  p_phase text default 'upcoming',
  p_cursor_event_date timestamptz default null,
  p_cursor_id uuid default null,
  p_now timestamptz default now(),
  p_limit integer default 26
)
returns table (item jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_phase not in ('upcoming', 'past') then
    raise invalid_parameter_value using message = 'Invalid event phase.';
  end if;

  return query
  with page as (
    select e.*
    from public.community_events e
    where e.is_public
      and e.city_id = p_city_id
      and case when p_phase = 'upcoming'
        then coalesce(e.end_date, e.event_date) >= p_now
          and (p_cursor_event_date is null or (e.event_date, e.id) > (p_cursor_event_date, p_cursor_id))
        else coalesce(e.end_date, e.event_date) < p_now
          and (p_cursor_event_date is null or (e.event_date, e.id) < (p_cursor_event_date, p_cursor_id))
      end
    order by
      case when p_phase = 'upcoming' then e.event_date end asc,
      case when p_phase = 'upcoming' then e.id end asc,
      case when p_phase = 'past' then e.event_date end desc,
      case when p_phase = 'past' then e.id end desc
    limit least(greatest(p_limit, 1), 26)
  )
  select to_jsonb(p) || jsonb_build_object(
    'users', case when u.id is null then null else jsonb_build_object('name', u.name, 'avatar_url', dp.avatar_url) end,
    'community_name', c.name,
    'community_image', coalesce(
      case c.type
        when 'city' then city.image_url
        when 'sector' then sector.image_url
        when 'experience_level' then experience.image_url
        when 'job_title' then job.image_url
      end,
      c.image_url
    ),
    'rsvp_count', (select count(*) from public.event_rsvps r where r.event_id = p.id),
    'like_count', (select count(*) from public.event_likes l where l.event_id = p.id),
    'save_count', (select count(*) from public.event_saves s where s.event_id = p.id),
    'user_rsvped', exists(select 1 from public.event_rsvps r where r.event_id = p.id and r.user_id = p_user_id),
    'user_liked', exists(select 1 from public.event_likes l where l.event_id = p.id and l.user_id = p_user_id),
    'user_saved', exists(select 1 from public.event_saves s where s.event_id = p.id and s.user_id = p_user_id)
  )
  from page p
  left join public.users u on u.id = p.user_id
  left join public.designer_profiles dp on dp.user_id = p.user_id
  left join public.communities c on c.id = p.community_id
  left join public.cities city
    on c.type = 'city' and city.id = c.reference_id
  left join public.design_sectors sector
    on c.type = 'sector' and sector.id = c.reference_id
  left join public.experience_levels experience
    on c.type = 'experience_level' and experience.id = c.reference_id
  left join public.job_titles job
    on c.type = 'job_title' and job.id = c.reference_id
  order by
    case when p_phase = 'upcoming' then p.event_date end asc,
    case when p_phase = 'upcoming' then p.id end asc,
    case when p_phase = 'past' then p.event_date end desc,
    case when p_phase = 'past' then p.id end desc;
end;
$$;

comment on function public.get_city_event_list_page(uuid, uuid, text, timestamptz, uuid, timestamptz, integer) is
  'One page of a city''s public events (upcoming or past), keyset-paginated on (event_date, id), projected like get_event_list_page plus the host, community name and community image; the interaction flags are resolved for p_user_id.';

revoke all on function public.get_city_event_list_page(uuid, uuid, text, timestamptz, uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.get_city_event_list_page(uuid, uuid, text, timestamptz, uuid, timestamptz, integer) to service_role;
