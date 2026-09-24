-- Home feed: the two dashboard scopes become disjoint, and the scope becomes an
-- explicit text argument instead of the boolean `p_member_only`.
--
--   'communities'  ("Your Communities")
--     every card from a community the caller has joined, regardless of the
--     card's `is_public` flag — the member already has read access to
--     community-private threads/events/resources/showcase posts.
--
--   'public'       ("Public Feed")
--     only cards with `is_public = true`, and only from communities the caller
--     has NOT joined: publicly shared work is what the public feed is for, and
--     the communities the member already follows have their own tab.
--
--   'all'          (legacy default)
--     every public card, exactly as before. Kept as the fallback so clients
--     that send no scope — the Expo home feed, older web deployments, the load
--     tests — keep the feed they have always had. Treating it as the default
--     is why the previous `p_member_only = false` behaviour is still reachable.
--
-- Before this migration both scopes required `is_public = true`, so a joined
-- community's private posts were visible nowhere on the homepage and its public
-- posts were duplicated across both tabs. `p_scope` also matches the sibling
-- feed RPC (`get_profile_feed_page`), which already takes a text scope.
--
-- The boolean 4-argument function is kept as a thin wrapper at the bottom of
-- this file so a web deployment still calling `p_member_only` keeps working
-- until the new build is live. Everything else in the payload projection
-- (community display picture resolution through the master-data rows,
-- aggregates, ordering, limit) is byte-for-byte the version from
-- 20260925010000_feed_community_dp_master.sql.

create or replace function public.get_home_feed_page(
  p_user_id uuid,
  p_before timestamptz default null,
  p_limit integer default 30,
  p_scope text default 'all'
)
returns table (item jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  with my_communities as (
    select m.community_id
    from public.community_members m
    where m.user_id = p_user_id
  ), candidates as (
    select 'thread'::text as kind, t.id, t.community_id, t.user_id, t.created_at, to_jsonb(t) as payload
    from public.community_threads t
    where t.community_id is not null
      and case p_scope
        when 'communities' then t.community_id in (select community_id from my_communities)
        when 'public' then t.is_public and t.community_id not in (select community_id from my_communities)
        else t.is_public
      end
      and (p_before is null or t.created_at < p_before)
    union all
    select 'event', e.id, e.community_id, e.user_id, e.created_at, to_jsonb(e)
    from public.community_events e
    where e.community_id is not null
      and case p_scope
        when 'communities' then e.community_id in (select community_id from my_communities)
        when 'public' then e.is_public and e.community_id not in (select community_id from my_communities)
        else e.is_public
      end
      and (p_before is null or e.created_at < p_before)
    union all
    select 'resource', r.id, r.community_id, r.user_id, r.created_at, to_jsonb(r)
    from public.community_resources r
    where r.community_id is not null
      and case p_scope
        when 'communities' then r.community_id in (select community_id from my_communities)
        when 'public' then r.is_public and r.community_id not in (select community_id from my_communities)
        else r.is_public
      end
      and (p_before is null or r.created_at < p_before)
    union all
    select 'showcase', s.id, s.community_id, s.user_id, s.created_at, to_jsonb(s)
    from public.community_showcase_posts s
    where s.community_id is not null
      and case p_scope
        when 'communities' then s.community_id in (select community_id from my_communities)
        when 'public' then s.is_public and s.community_id not in (select community_id from my_communities)
        else s.is_public
      end
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
    'community_image', coalesce(
      case c.type
        when 'city' then city.image_url
        when 'sector' then sector.image_url
        when 'interest' then interest.image_url
        when 'experience_level' then experience.image_url
        when 'job_title' then job.image_url
      end,
      c.image_url
    ),
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
  left join public.cities city
    on c.type = 'city' and city.id = c.reference_id
  left join public.design_sectors sector
    on c.type = 'sector' and sector.id = c.reference_id
  left join public.design_interests interest
    on c.type = 'interest' and interest.id = c.reference_id
  left join public.experience_levels experience
    on c.type = 'experience_level' and experience.id = c.reference_id
  left join public.job_titles job
    on c.type = 'job_title' and job.id = c.reference_id
  order by p.created_at desc, p.id desc;
$$;

revoke all on function public.get_home_feed_page(uuid, timestamptz, integer, text) from public, anon, authenticated;
grant execute on function public.get_home_feed_page(uuid, timestamptz, integer, text) to service_role;

-- Back-compat: the pre-`p_scope` call shape, delegating to the scoped function.
-- Postgres cannot rename an input parameter through `create or replace`, so the
-- old signature has to stay a separate function. `true` now means the member
-- scope (which is the bug fix this migration ships); `false` keeps the legacy
-- every-public-post feed.
create or replace function public.get_home_feed_page(
  p_user_id uuid,
  p_before timestamptz default null,
  p_limit integer default 30,
  p_member_only boolean default false
)
returns table (item jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from public.get_home_feed_page(
    p_user_id,
    p_before,
    p_limit,
    (case when p_member_only then 'communities' else 'all' end)::text
  );
$$;

revoke all on function public.get_home_feed_page(uuid, timestamptz, integer, boolean) from public, anon, authenticated;
grant execute on function public.get_home_feed_page(uuid, timestamptz, integer, boolean) to service_role;
