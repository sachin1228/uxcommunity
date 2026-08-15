-- Include is_public in the community showcase list RPC so the UI can reflect
-- and edit the public-sharing flag, matching threads/events/resources.
--
-- Also stop stripping is_public from showcase payloads in the home feed RPC so
-- the edit modal can restore the correct public flag when a public community
-- showcase post is edited from the feed.

drop function if exists public.get_showcase_list_page(uuid, uuid, timestamptz, uuid, integer);

create or replace function public.get_showcase_list_page(
  p_community_id uuid,
  p_user_id uuid,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 26
)
returns table (
  id uuid,
  community_id uuid,
  user_id uuid,
  title text,
  description text,
  image_url text,
  project_url text,
  post_type text,
  category text,
  tags text[],
  is_public boolean,
  created_at timestamptz,
  updated_at timestamptz,
  author jsonb,
  like_count integer,
  comment_count integer,
  user_liked boolean,
  user_saved boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  with page as (
    select post.*
    from public.community_showcase_posts as post
    where post.community_id = p_community_id
      and (
        p_cursor_created_at is null
        or post.created_at < p_cursor_created_at
        or (post.created_at = p_cursor_created_at and post.id < p_cursor_id)
      )
    order by post.created_at desc, post.id desc
    limit greatest(0, least(coalesce(p_limit, 26), 100))
  ),
  likes as (
    select showcase_like.post_id,
      count(*)::integer as like_count,
      bool_or(showcase_like.user_id = p_user_id) as user_liked
    from public.showcase_likes as showcase_like
    where showcase_like.post_id in (select page.id from page)
    group by showcase_like.post_id
  ),
  saves as (
    select showcase_save.post_id,
      bool_or(showcase_save.user_id = p_user_id) as user_saved
    from public.showcase_saves as showcase_save
    where showcase_save.post_id in (select page.id from page)
    group by showcase_save.post_id
  ),
  comments as (
    select showcase_comment.post_id, count(*)::integer as comment_count
    from public.showcase_comments as showcase_comment
    where showcase_comment.post_id in (select page.id from page)
    group by showcase_comment.post_id
  )
  select
    page.id,
    page.community_id,
    page.user_id,
    page.title,
    page.description,
    page.image_url,
    page.project_url,
    page.post_type,
    page.category,
    page.tags,
    page.is_public,
    page.created_at,
    page.updated_at,
    jsonb_build_object(
      'name', coalesce(showcase_author.name, 'Community member'),
      'avatar_url', showcase_profile.avatar_url
    ) as author,
    coalesce(likes.like_count, 0) as like_count,
    coalesce(comments.comment_count, 0) as comment_count,
    coalesce(likes.user_liked, false) as user_liked,
    coalesce(saves.user_saved, false) as user_saved
  from page
  left join public.users as showcase_author on showcase_author.id = page.user_id
  left join public.designer_profiles as showcase_profile on showcase_profile.user_id = page.user_id
  left join likes on likes.post_id = page.id
  left join saves on saves.post_id = page.id
  left join comments on comments.post_id = page.id
  order by page.created_at desc, page.id desc;
$$;

comment on function public.get_showcase_list_page(uuid, uuid, timestamptz, uuid, integer) is
  'Returns one authorized showcase page with author and interaction aggregates.';

revoke all on function public.get_showcase_list_page(uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.get_showcase_list_page(uuid, uuid, timestamptz, uuid, integer) to service_role;

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
    'vote_count', case when p.kind = 'thread' then (select count(*) from public.thread_votes x where x.thread_id = p.id) else 0 end,
    'user_voted', p.kind = 'thread' and exists(select 1 from public.thread_votes x where x.thread_id = p.id and x.user_id = p_user_id),
    'rsvp_count', case when p.kind = 'event' then (select count(*) from public.event_rsvps x where x.event_id = p.id) else 0 end,
    'user_rsvped', p.kind = 'event' and exists(select 1 from public.event_rsvps x where x.event_id = p.id and x.user_id = p_user_id),
    'like_count', case
      when p.kind = 'event' then (select count(*) from public.event_likes x where x.event_id = p.id)
      when p.kind = 'showcase' then (select count(*) from public.showcase_likes x where x.post_id = p.id)
      else 0 end,
    'user_liked', (p.kind = 'event' and exists(select 1 from public.event_likes x where x.event_id = p.id and x.user_id = p_user_id))
      or (p.kind = 'showcase' and exists(select 1 from public.showcase_likes x where x.post_id = p.id and x.user_id = p_user_id)),
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