-- ============================================================
-- Online/type + date filters for the city events page
--
-- WHY
--   The Events page's filter row: All / Online / In person, and
--   Any date / Today / This week / This month. The filters run in SQL
--   — a client-side filter over the loaded page would lie once a
--   matching event sat on a later page, and "Load more" would page
--   the unfiltered stream.
--
-- WHAT
--   get_city_event_list_page is replaced (old signature dropped and
--   re-granted) with three optional params appended after p_limit:
--     p_is_online  null = both types, true = online only,
--                  false = in person only
--     p_from       lower bound on the event's start date (inclusive)
--     p_to         upper bound on the event's start date (exclusive)
--
--   The window is on the start (event_date), not the end: "Today"
--   means events that start today, which is what a listing means by
--   the word.
--
-- Deploy note: pure replacement — run after 20261010120000_event_city.sql
-- (which adds the column, the index and the previous shape of this
-- function). No backfill; safe to apply while the release is live.
-- ============================================================

drop function if exists public.get_city_event_list_page(uuid, uuid, text, timestamptz, uuid, timestamptz, integer);

create or replace function public.get_city_event_list_page(
  p_city_id uuid,
  p_user_id uuid,
  p_phase text default 'upcoming',
  p_cursor_event_date timestamptz default null,
  p_cursor_id uuid default null,
  p_now timestamptz default now(),
  p_limit integer default 26,
  p_is_online boolean default null,
  p_from timestamptz default null,
  p_to timestamptz default null
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
      and (p_is_online is null or e.is_online = p_is_online)
      and (p_from is null or e.event_date >= p_from)
      and (p_to is null or e.event_date < p_to)
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

comment on function public.get_city_event_list_page(uuid, uuid, text, timestamptz, uuid, timestamptz, integer, boolean, timestamptz, timestamptz) is
  'One page of a city''s public events (upcoming or past), keyset-paginated on (event_date, id), optionally filtered by type (p_is_online) and a start-date window ([p_from, p_to)); projected like get_event_list_page plus the host, community name and community image, with the interaction flags resolved for p_user_id.';

revoke all on function public.get_city_event_list_page(uuid, uuid, text, timestamptz, uuid, timestamptz, integer, boolean, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.get_city_event_list_page(uuid, uuid, text, timestamptz, uuid, timestamptz, integer, boolean, timestamptz, timestamptz) to service_role;
