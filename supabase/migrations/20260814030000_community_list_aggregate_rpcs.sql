-- Return page-bounded interaction aggregates without transferring every interaction row.
-- API routes authorize community membership before invoking these service-role-only RPCs.

create or replace function public.get_thread_list_aggregates(
  p_user_id uuid,
  p_thread_ids uuid[] default '{}'::uuid[]
)
returns table (
  id uuid,
  vote_count bigint,
  comment_count bigint,
  user_voted boolean,
  user_saved boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with requested as (
    select distinct requested_id as id
    from unnest(coalesce(p_thread_ids, '{}'::uuid[])) as input(requested_id)
  ),
  votes as (
    select v.thread_id as id,
      count(*) as vote_count,
      bool_or(v.user_id = p_user_id) as user_voted
    from public.thread_votes as v
    where v.thread_id = any(coalesce(p_thread_ids, '{}'::uuid[]))
    group by v.thread_id
  ),
  comments as (
    select c.thread_id as id, count(*) as comment_count
    from public.thread_comments as c
    where c.thread_id = any(coalesce(p_thread_ids, '{}'::uuid[]))
    group by c.thread_id
  ),
  saves as (
    select s.thread_id as id, bool_or(s.user_id = p_user_id) as user_saved
    from public.thread_saves as s
    where s.thread_id = any(coalesce(p_thread_ids, '{}'::uuid[]))
    group by s.thread_id
  )
  select requested.id,
    coalesce(votes.vote_count, 0),
    coalesce(comments.comment_count, 0),
    coalesce(votes.user_voted, false),
    coalesce(saves.user_saved, false)
  from requested
  left join votes using (id)
  left join comments using (id)
  left join saves using (id);
$$;

create or replace function public.get_event_list_aggregates(
  p_user_id uuid,
  p_event_ids uuid[] default '{}'::uuid[]
)
returns table (
  id uuid,
  rsvp_count bigint,
  like_count bigint,
  save_count bigint,
  user_rsvped boolean,
  user_liked boolean,
  user_saved boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with requested as (
    select distinct requested_id as id
    from unnest(coalesce(p_event_ids, '{}'::uuid[])) as input(requested_id)
  ),
  rsvps as (
    select r.event_id as id,
      count(*) as rsvp_count,
      bool_or(r.user_id = p_user_id) as user_rsvped
    from public.event_rsvps as r
    where r.event_id = any(coalesce(p_event_ids, '{}'::uuid[]))
    group by r.event_id
  ),
  likes as (
    select l.event_id as id,
      count(*) as like_count,
      bool_or(l.user_id = p_user_id) as user_liked
    from public.event_likes as l
    where l.event_id = any(coalesce(p_event_ids, '{}'::uuid[]))
    group by l.event_id
  ),
  saves as (
    select s.event_id as id,
      count(*) as save_count,
      bool_or(s.user_id = p_user_id) as user_saved
    from public.event_saves as s
    where s.event_id = any(coalesce(p_event_ids, '{}'::uuid[]))
    group by s.event_id
  )
  select requested.id,
    coalesce(rsvps.rsvp_count, 0),
    coalesce(likes.like_count, 0),
    coalesce(saves.save_count, 0),
    coalesce(rsvps.user_rsvped, false),
    coalesce(likes.user_liked, false),
    coalesce(saves.user_saved, false)
  from requested
  left join rsvps using (id)
  left join likes using (id)
  left join saves using (id);
$$;

create or replace function public.get_resource_list_aggregates(
  p_user_id uuid,
  p_resource_ids uuid[] default '{}'::uuid[]
)
returns table (
  id uuid,
  save_count bigint,
  comment_count bigint,
  bookmark_count bigint,
  user_saved boolean,
  user_bookmarked boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with requested as (
    select distinct requested_id as id
    from unnest(coalesce(p_resource_ids, '{}'::uuid[])) as input(requested_id)
  ),
  saves as (
    select s.resource_id as id,
      count(*) as save_count,
      bool_or(s.user_id = p_user_id) as user_saved
    from public.resource_saves as s
    where s.resource_id = any(coalesce(p_resource_ids, '{}'::uuid[]))
    group by s.resource_id
  ),
  comments as (
    select c.resource_id as id, count(*) as comment_count
    from public.resource_comments as c
    where c.resource_id = any(coalesce(p_resource_ids, '{}'::uuid[]))
    group by c.resource_id
  ),
  bookmarks as (
    select b.resource_id as id,
      count(*) as bookmark_count,
      bool_or(b.user_id = p_user_id) as user_bookmarked
    from public.resource_bookmarks as b
    where b.resource_id = any(coalesce(p_resource_ids, '{}'::uuid[]))
    group by b.resource_id
  )
  select requested.id,
    coalesce(saves.save_count, 0),
    coalesce(comments.comment_count, 0),
    coalesce(bookmarks.bookmark_count, 0),
    coalesce(saves.user_saved, false),
    coalesce(bookmarks.user_bookmarked, false)
  from requested
  left join saves using (id)
  left join comments using (id)
  left join bookmarks using (id);
$$;

comment on function public.get_thread_list_aggregates(uuid, uuid[]) is
  'Returns interaction aggregates for one authorized thread list page.';
comment on function public.get_event_list_aggregates(uuid, uuid[]) is
  'Returns interaction aggregates for one authorized event list page.';
comment on function public.get_resource_list_aggregates(uuid, uuid[]) is
  'Returns interaction aggregates for one authorized resource list page.';

revoke all on function public.get_thread_list_aggregates(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.get_event_list_aggregates(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.get_resource_list_aggregates(uuid, uuid[]) from public, anon, authenticated;

grant execute on function public.get_thread_list_aggregates(uuid, uuid[]) to service_role;
grant execute on function public.get_event_list_aggregates(uuid, uuid[]) to service_role;
grant execute on function public.get_resource_list_aggregates(uuid, uuid[]) to service_role;
