-- Consolidate home-feed interaction enrichment into one database round trip.
-- The function scans only IDs already selected for the current 30-item page.
-- Existing primary/foreign-key indexes support every grouped lookup, so this
-- migration intentionally adds no speculative indexes or write amplification.

create or replace function public.get_home_feed_interactions(
  p_user_id uuid,
  p_thread_ids uuid[] default '{}'::uuid[],
  p_event_ids uuid[] default '{}'::uuid[],
  p_resource_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'threads', coalesce((
      select jsonb_object_agg(ids.id, jsonb_build_object(
        'comment_count', (select count(*) from public.thread_comments c where c.thread_id = ids.id),
        'vote_count', (select count(*) from public.thread_votes v where v.thread_id = ids.id),
        'user_voted', exists(select 1 from public.thread_votes v where v.thread_id = ids.id and v.user_id = p_user_id),
        'user_saved', exists(select 1 from public.thread_saves s where s.thread_id = ids.id and s.user_id = p_user_id)
      ))
      from unnest(p_thread_ids) ids(id)
    ), '{}'::jsonb),
    'events', coalesce((
      select jsonb_object_agg(ids.id, jsonb_build_object(
        'comment_count', (select count(*) from public.event_comments c where c.event_id = ids.id),
        'rsvp_count', (select count(*) from public.event_rsvps r where r.event_id = ids.id),
        'user_rsvped', exists(select 1 from public.event_rsvps r where r.event_id = ids.id and r.user_id = p_user_id),
        'save_count', (select count(*) from public.event_saves s where s.event_id = ids.id),
        'user_saved', exists(select 1 from public.event_saves s where s.event_id = ids.id and s.user_id = p_user_id)
      ))
      from unnest(p_event_ids) ids(id)
    ), '{}'::jsonb),
    'resources', coalesce((
      select jsonb_object_agg(ids.id, jsonb_build_object(
        'comment_count', (select count(*) from public.resource_comments c where c.resource_id = ids.id),
        'save_count', (select count(*) from public.resource_saves s where s.resource_id = ids.id),
        'user_saved', exists(select 1 from public.resource_saves s where s.resource_id = ids.id and s.user_id = p_user_id),
        'bookmark_count', (select count(*) from public.resource_bookmarks b where b.resource_id = ids.id),
        'user_bookmarked', exists(select 1 from public.resource_bookmarks b where b.resource_id = ids.id and b.user_id = p_user_id)
      ))
      from unnest(p_resource_ids) ids(id)
    ), '{}'::jsonb)
  );
$$;

comment on function public.get_home_feed_interactions(uuid, uuid[], uuid[], uuid[]) is
  'Returns interaction counts and caller state for one bounded home-feed page.';

revoke all on function public.get_home_feed_interactions(uuid, uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.get_home_feed_interactions(uuid, uuid[], uuid[], uuid[]) to service_role;
