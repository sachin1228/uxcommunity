-- Return a bounded set of real attendee profiles for event cards.
-- The total remains sourced from the existing aggregate RPCs.
create or replace function public.get_event_attendee_previews(
  p_event_ids uuid[],
  p_limit integer default 5
)
returns table (id uuid, rsvps jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    event.id,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'event_id', attendee.event_id,
          'user_id', attendee.user_id,
          'created_at', attendee.created_at,
          'users', case
            when attendee.name is null then null
            else jsonb_build_object(
              'name', attendee.name,
              'avatar_url', attendee.avatar_url
            )
          end
        )
        order by attendee.created_at asc
      ) filter (where attendee.user_id is not null),
      '[]'::jsonb
    ) as rsvps
  from unnest(coalesce(p_event_ids, '{}'::uuid[])) as event(id)
  left join lateral (
    select
      er.event_id,
      er.user_id,
      er.created_at,
      u.name,
      dp.avatar_url
    from public.event_rsvps er
    left join public.users u on u.id = er.user_id
    left join public.designer_profiles dp on dp.user_id = er.user_id
    where er.event_id = event.id
    order by er.created_at asc
    limit least(greatest(p_limit, 1), 5)
  ) attendee on true
  group by event.id;
$$;

revoke all on function public.get_event_attendee_previews(uuid[], integer) from public, anon, authenticated;
grant execute on function public.get_event_attendee_previews(uuid[], integer) to service_role;
