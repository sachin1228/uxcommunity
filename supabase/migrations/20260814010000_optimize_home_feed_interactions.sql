-- Replace per-item correlated interaction lookups with page-bounded, set-based
-- aggregates. Each interaction table is scanned at most once for the IDs in the
-- requested feed page. Existing foreign-key/primary-key indexes support these
-- predicates, so no additional indexes or write amplification are introduced.

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
  with
  thread_ids as (
    select distinct id
    from unnest(coalesce(p_thread_ids, '{}'::uuid[])) as requested(id)
  ),
  thread_comment_counts as (
    select comments.thread_id as id, count(*) as comment_count
    from public.thread_comments as comments
    where comments.thread_id = any(coalesce(p_thread_ids, '{}'::uuid[]))
    group by comments.thread_id
  ),
  thread_vote_counts as (
    select votes.thread_id as id,
      count(*) as vote_count,
      bool_or(votes.user_id = p_user_id) as user_voted
    from public.thread_votes as votes
    where votes.thread_id = any(coalesce(p_thread_ids, '{}'::uuid[]))
    group by votes.thread_id
  ),
  thread_save_state as (
    select saves.thread_id as id,
      bool_or(saves.user_id = p_user_id) as user_saved
    from public.thread_saves as saves
    where saves.thread_id = any(coalesce(p_thread_ids, '{}'::uuid[]))
    group by saves.thread_id
  ),
  thread_interactions as (
    select coalesce(jsonb_object_agg(ids.id, jsonb_build_object(
      'comment_count', coalesce(comments.comment_count, 0),
      'vote_count', coalesce(votes.vote_count, 0),
      'user_voted', coalesce(votes.user_voted, false),
      'user_saved', coalesce(saves.user_saved, false)
    )), '{}'::jsonb) as value
    from thread_ids as ids
    left join thread_comment_counts as comments using (id)
    left join thread_vote_counts as votes using (id)
    left join thread_save_state as saves using (id)
  ),
  event_ids as (
    select distinct id
    from unnest(coalesce(p_event_ids, '{}'::uuid[])) as requested(id)
  ),
  event_comment_counts as (
    select comments.event_id as id, count(*) as comment_count
    from public.event_comments as comments
    where comments.event_id = any(coalesce(p_event_ids, '{}'::uuid[]))
    group by comments.event_id
  ),
  event_rsvp_counts as (
    select rsvps.event_id as id,
      count(*) as rsvp_count,
      bool_or(rsvps.user_id = p_user_id) as user_rsvped
    from public.event_rsvps as rsvps
    where rsvps.event_id = any(coalesce(p_event_ids, '{}'::uuid[]))
    group by rsvps.event_id
  ),
  event_like_counts as (
    select likes.event_id as id,
      count(*) as like_count,
      bool_or(likes.user_id = p_user_id) as user_liked
    from public.event_likes as likes
    where likes.event_id = any(coalesce(p_event_ids, '{}'::uuid[]))
    group by likes.event_id
  ),
  event_save_counts as (
    select saves.event_id as id,
      count(*) as save_count,
      bool_or(saves.user_id = p_user_id) as user_saved
    from public.event_saves as saves
    where saves.event_id = any(coalesce(p_event_ids, '{}'::uuid[]))
    group by saves.event_id
  ),
  event_interactions as (
    select coalesce(jsonb_object_agg(ids.id, jsonb_build_object(
      'comment_count', coalesce(comments.comment_count, 0),
      'rsvp_count', coalesce(rsvps.rsvp_count, 0),
      'user_rsvped', coalesce(rsvps.user_rsvped, false),
      'like_count', coalesce(likes.like_count, 0),
      'user_liked', coalesce(likes.user_liked, false),
      'save_count', coalesce(saves.save_count, 0),
      'user_saved', coalesce(saves.user_saved, false)
    )), '{}'::jsonb) as value
    from event_ids as ids
    left join event_comment_counts as comments using (id)
    left join event_rsvp_counts as rsvps using (id)
    left join event_like_counts as likes using (id)
    left join event_save_counts as saves using (id)
  ),
  resource_ids as (
    select distinct id
    from unnest(coalesce(p_resource_ids, '{}'::uuid[])) as requested(id)
  ),
  resource_comment_counts as (
    select comments.resource_id as id, count(*) as comment_count
    from public.resource_comments as comments
    where comments.resource_id = any(coalesce(p_resource_ids, '{}'::uuid[]))
    group by comments.resource_id
  ),
  resource_save_counts as (
    select saves.resource_id as id,
      count(*) as save_count,
      bool_or(saves.user_id = p_user_id) as user_saved
    from public.resource_saves as saves
    where saves.resource_id = any(coalesce(p_resource_ids, '{}'::uuid[]))
    group by saves.resource_id
  ),
  resource_bookmark_counts as (
    select bookmarks.resource_id as id,
      count(*) as bookmark_count,
      bool_or(bookmarks.user_id = p_user_id) as user_bookmarked
    from public.resource_bookmarks as bookmarks
    where bookmarks.resource_id = any(coalesce(p_resource_ids, '{}'::uuid[]))
    group by bookmarks.resource_id
  ),
  resource_interactions as (
    select coalesce(jsonb_object_agg(ids.id, jsonb_build_object(
      'comment_count', coalesce(comments.comment_count, 0),
      'save_count', coalesce(saves.save_count, 0),
      'user_saved', coalesce(saves.user_saved, false),
      'bookmark_count', coalesce(bookmarks.bookmark_count, 0),
      'user_bookmarked', coalesce(bookmarks.user_bookmarked, false)
    )), '{}'::jsonb) as value
    from resource_ids as ids
    left join resource_comment_counts as comments using (id)
    left join resource_save_counts as saves using (id)
    left join resource_bookmark_counts as bookmarks using (id)
  )
  select jsonb_build_object(
    'threads', (select value from thread_interactions),
    'events', (select value from event_interactions),
    'resources', (select value from resource_interactions)
  );
$$;

comment on function public.get_home_feed_interactions(uuid, uuid[], uuid[], uuid[]) is
  'Returns set-based interaction counts and caller state for one bounded home-feed page.';

revoke all on function public.get_home_feed_interactions(uuid, uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.get_home_feed_interactions(uuid, uuid[], uuid[], uuid[]) to service_role;
