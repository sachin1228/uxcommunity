-- Stop stripping is_public from RPC responses so the client can read
-- the toggle value when editing resources/threads.

-- 1. get_thread_list_page — remove '- is_public'
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
  )
  from page p
  left join public.users u on u.id = p.user_id
  left join public.designer_profiles dp on dp.user_id = p.user_id
  order by p.created_at desc, p.id desc;
end;
$$;

-- 2. get_resource_list_page — remove '- is_public'
create or replace function public.get_resource_list_page(
  p_community_id uuid,
  p_user_id uuid,
  p_before timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 100
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
    select r.*
    from public.community_resources r
    where r.community_id = p_community_id
      and (p_before is null or (r.created_at, r.id) < (p_before, p_cursor_id))
    order by r.created_at desc, r.id desc
    limit least(greatest(p_limit, 1), 200)
  )
  select to_jsonb(p) || jsonb_build_object(
    'users', case when u.id is null then null else jsonb_build_object('name', u.name, 'avatar_url', dp.avatar_url) end,
    'save_count', (select count(*) from public.resource_saves s where s.resource_id = p.id),
    'comment_count', (select count(*) from public.resource_comments c where c.resource_id = p.id),
    'bookmark_count', (select count(*) from public.resource_bookmarks b where b.resource_id = p.id),
    'user_saved', exists(select 1 from public.resource_saves s where s.resource_id = p.id and s.user_id = p_user_id),
    'user_bookmarked', exists(select 1 from public.resource_bookmarks b where b.resource_id = p.id and b.user_id = p_user_id)
  )
  from page p
  left join public.users u on u.id = p.user_id
  left join public.designer_profiles dp on dp.user_id = p.user_id
  order by p.created_at desc, p.id desc;
end;
$$;

-- 3. get_home_feed_page — remove '- is_public'
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
    where t.is_public = true and t.community_id is not null
      and (p_before is null or t.created_at < p_before)
    union all
    select 'event', e.id, e.community_id, e.user_id, e.created_at, to_jsonb(e)
    from public.community_events e
    where e.is_public = true and e.community_id is not null
      and (p_before is null or e.created_at < p_before)
    union all
    select 'resource', r.id, r.community_id, r.user_id, r.created_at, to_jsonb(r)
    from public.community_resources r
    where r.is_public = true and r.community_id is not null
      and (p_before is null or r.created_at < p_before)
    union all
    select 'showcase', s.id, s.community_id, s.user_id, s.created_at, to_jsonb(s)
    from public.community_showcase_posts s
    where s.is_public = true and s.community_id is not null
      and (p_before is null or s.created_at < p_before)
  ), page as (
    select * from candidates
    order by created_at desc, id desc
    limit least(greatest(p_limit, 1), 30)
  )
  select p.payload || jsonb_build_object(
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
      when p.kind = 'showcase' then (select count(*) from public.showcase_saves x where x.post_id = p.id)
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

revoke all on function public.get_thread_list_page(uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.get_resource_list_page(uuid, uuid, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.get_home_feed_page(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.get_thread_list_page(uuid, uuid, timestamptz, uuid, integer) to service_role;
grant execute on function public.get_resource_list_page(uuid, uuid, timestamptz, uuid, integer) to service_role;
grant execute on function public.get_home_feed_page(uuid, timestamptz, integer) to service_role;
