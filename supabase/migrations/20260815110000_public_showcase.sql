-- Allow showcase posts to be shared publicly on the home feed.
--
-- Mirrors the public-content model used for threads, events, and resources:
-- a showcase created from the home feed is stored with a null community_id and
-- is_public = true, and is included in the home feed RPC.

alter table public.community_showcase_posts
  alter column community_id drop not null;

alter table public.community_showcase_posts
  add column if not exists is_public boolean not null default false;

comment on column public.community_showcase_posts.is_public is 'When true, any logged-in user can view this showcase post on the home feed.';
comment on column public.community_showcase_posts.community_id is 'Null for showcase posts created directly from the public home feed.';

-- Partial index supporting the public-feed scan and cursor ordering.
create index if not exists idx_community_showcase_posts_public_created
  on public.community_showcase_posts (created_at desc) where is_public = true;

-- Include public showcase posts in the home feed alongside public threads,
-- events, and resources.
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
  select (p.payload - 'is_public') || jsonb_build_object(
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