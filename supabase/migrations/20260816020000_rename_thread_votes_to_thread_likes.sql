-- ============================================================
-- Rename thread votes to thread likes (thread_likes)
--
-- The UI has used "like" branding for thread hearts for a while
-- ("liked your thread", Instagram-style heart, error strings). This
-- migration finishes the rename end-to-end:
--   1. Renames the thread_votes table and its indexes to thread_likes.
--   2. Recreates the RPC functions that reference the table so they use
--      thread_likes and return like_count / user_liked keys (matching
--      the event/showcase like naming already in place).
-- ============================================================

-- 1. Rename table + indexes. RLS policy, realtime publication membership
--    and replica identity follow the table through the rename.
alter table thread_votes rename to thread_likes;
alter index idx_thread_votes_thread rename to idx_thread_likes_thread;
alter index idx_thread_votes_user rename to idx_thread_likes_user;

-- 2. Recreate the RPCs that reference the renamed table.
--
-- get_thread_list_aggregates changes a returns-table column name
-- (vote_count -> like_count, user_voted -> user_liked), which
-- create-or-replace cannot do, so drop it first.

drop function if exists public.get_thread_list_aggregates(uuid, uuid[]);

create or replace function public.get_thread_list_aggregates(
  p_user_id uuid,
  p_thread_ids uuid[] default '{}'::uuid[]
)
returns table (
  id uuid,
  like_count bigint,
  comment_count bigint,
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
    from unnest(coalesce(p_thread_ids, '{}'::uuid[])) as input(requested_id)
  ),
  likes as (
    select l.thread_id as id,
      count(*) as like_count,
      bool_or(l.user_id = p_user_id) as user_liked
    from public.thread_likes as l
    where l.thread_id = any(coalesce(p_thread_ids, '{}'::uuid[]))
    group by l.thread_id
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
    coalesce(likes.like_count, 0),
    coalesce(comments.comment_count, 0),
    coalesce(likes.user_liked, false),
    coalesce(saves.user_saved, false)
  from requested
  left join likes using (id)
  left join comments using (id)
  left join saves using (id);
$$;

revoke all on function public.get_thread_list_aggregates(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.get_thread_list_aggregates(uuid, uuid[]) to service_role;

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
  thread_like_counts as (
    select likes.thread_id as id,
      count(*) as like_count,
      bool_or(likes.user_id = p_user_id) as user_liked
    from public.thread_likes as likes
    where likes.thread_id = any(coalesce(p_thread_ids, '{}'::uuid[]))
    group by likes.thread_id
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
      'like_count', coalesce(likes.like_count, 0),
      'user_liked', coalesce(likes.user_liked, false),
      'user_saved', coalesce(saves.user_saved, false)
    )), '{}'::jsonb) as value
    from thread_ids as ids
    left join thread_comment_counts as comments using (id)
    left join thread_like_counts as likes using (id)
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

revoke all on function public.get_home_feed_interactions(uuid, uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.get_home_feed_interactions(uuid, uuid[], uuid[], uuid[]) to service_role;

create or replace function public.get_thread_list_page(
  p_community_id uuid,
  p_user_id uuid,
  p_before timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 50
)
returns table (item jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.community_members m
    where m.community_id = p_community_id and m.user_id = p_user_id
  ) then
    raise insufficient_privilege using message = 'Not a member of this community.';
  end if;

  return query
  with page as (
    select t.*
    from public.community_threads t
    where t.community_id = p_community_id
      and (p_before is null or (t.created_at, t.id) < (p_before, p_cursor_id))
    order by t.created_at desc, t.id desc
    limit least(greatest(p_limit, 1), 100)
  )
  select to_jsonb(p) || jsonb_build_object(
    'users', case when u.id is null then null else jsonb_build_object('name', u.name, 'avatar_url', dp.avatar_url) end,
    'like_count', (select count(*) from public.thread_likes l where l.thread_id = p.id),
    'comment_count', (select count(*) from public.thread_comments c where c.thread_id = p.id),
    'user_liked', exists(select 1 from public.thread_likes l where l.thread_id = p.id and l.user_id = p_user_id),
    'user_saved', exists(select 1 from public.thread_saves s where s.thread_id = p.id and s.user_id = p_user_id)
  ) - 'is_public'
  from page p
  left join public.users u on u.id = p.user_id
  left join public.designer_profiles dp on dp.user_id = p.user_id
  order by p.created_at desc, p.id desc;
end;
$$;

revoke all on function public.get_thread_list_page(uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.get_thread_list_page(uuid, uuid, timestamptz, uuid, integer) to service_role;

create or replace function public.get_home_feed_page(
  p_user_id uuid,
  p_before timestamptz default null,
  p_limit integer default 30
)
returns table (item jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  with candidates as (
    select 'thread'::text as kind, t.id, t.community_id, t.user_id, t.created_at, to_jsonb(t) as payload
    from public.community_threads t
    where t.is_public = true and (p_before is null or t.created_at < p_before)
    union all
    select 'event', e.id, e.community_id, e.user_id, e.created_at, to_jsonb(e)
    from public.community_events e
    where e.is_public = true and (p_before is null or e.created_at < p_before)
    union all
    select 'resource', r.id, r.community_id, r.user_id, r.created_at, to_jsonb(r)
    from public.community_resources r
    where r.is_public = true and (p_before is null or r.created_at < p_before)
    union all
    select 'showcase', s.id, s.community_id, s.user_id, s.created_at, to_jsonb(s)
    from public.community_showcase_posts s
    where s.is_public = true and (p_before is null or s.created_at < p_before)
  ), page as (
    select * from candidates
    order by created_at desc, id desc
    limit least(greatest(p_limit, 1), 30)
  )
  select case when p.kind = 'showcase' then p.payload else (p.payload - 'is_public') end
    || jsonb_build_object(
    '_type', p.kind,
    'users', case when u.id is null then null else jsonb_build_object('name', u.name, 'avatar_url', dp.avatar_url) end,
    'author', case
      when p.kind = 'showcase' then jsonb_build_object('name', coalesce(u.name, 'Community member'), 'avatar_url', dp.avatar_url)
      else null
    end,
    'community_name', c.name,
    'community_image', c.image_url,
    'comment_count', case p.kind
      when 'thread' then (select count(*) from public.thread_comments x where x.thread_id = p.id)
      when 'resource' then (select count(*) from public.resource_comments x where x.resource_id = p.id)
      when 'event' then (select count(*) from public.event_comments x where x.event_id = p.id)
      when 'showcase' then (select count(*) from public.showcase_comments x where x.post_id = p.id)
    end,
    'like_count', case
      when p.kind = 'thread' then (select count(*) from public.thread_likes x where x.thread_id = p.id)
      when p.kind = 'event' then (select count(*) from public.event_likes x where x.event_id = p.id)
      when p.kind = 'showcase' then (select count(*) from public.showcase_likes x where x.post_id = p.id)
      else 0 end,
    'user_liked', (p.kind = 'thread' and exists(select 1 from public.thread_likes x where x.thread_id = p.id and x.user_id = p_user_id))
      or (p.kind = 'event' and exists(select 1 from public.event_likes x where x.event_id = p.id and x.user_id = p_user_id))
      or (p.kind = 'showcase' and exists(select 1 from public.showcase_likes x where x.post_id = p.id and x.user_id = p_user_id)),
    'rsvp_count', case when p.kind = 'event' then (select count(*) from public.event_rsvps x where x.event_id = p.id) else 0 end,
    'user_rsvped', p.kind = 'event' and exists(select 1 from public.event_rsvps x where x.event_id = p.id and x.user_id = p_user_id),
    'save_count', case
      when p.kind = 'event' then (select count(*) from public.event_saves x where x.event_id = p.id)
      when p.kind = 'resource' then (select count(*) from public.resource_saves x where x.resource_id = p.id)
      else 0 end,
    'user_saved', case p.kind
      when 'thread' then exists(select 1 from public.thread_saves x where x.thread_id = p.id and x.user_id = p_user_id)
      when 'event' then exists(select 1 from public.event_saves x where x.event_id = p.id and x.user_id = p_user_id)
      when 'resource' then exists(select 1 from public.resource_saves x where x.resource_id = p.id and x.user_id = p_user_id)
      when 'showcase' then exists(select 1 from public.showcase_saves x where x.post_id = p.id and x.user_id = p_user_id)
    end,
    'bookmark_count', case when p.kind = 'resource' then (select count(*) from public.resource_bookmarks x where x.resource_id = p.id) else 0 end,
    'user_bookmarked', p.kind = 'resource' and exists(select 1 from public.resource_bookmarks x where x.resource_id = p.id and x.user_id = p_user_id)
  )
  from page p
  left join public.users u on u.id = p.user_id
  left join public.designer_profiles dp on dp.user_id = p.user_id
  left join public.communities c on c.id = p.community_id
  order by p.created_at desc, p.id desc;
$$;

revoke all on function public.get_home_feed_page(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.get_home_feed_page(uuid, timestamptz, integer) to service_role;