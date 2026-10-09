-- ============================================================
-- Member activity feed for member profile pages
--
-- WHY
--   A member's profile (`/dashboard/profile/[userId]`) shows an
--   identity card only. What they have shared is the other half of
--   the page, but a visitor must never see more than their own
--   feeds already show them. The profile list is therefore the
--   viewer's feed filtered by author — never a privilege change.
--
-- WHAT
--   `get_member_feed_page(p_viewer_id, p_author_id, …)` mirrors
--   `get_profile_feed_page`'s projection (same card payload, same
--   per-viewer interaction flags) with two changes:
--     1. it lists cards authored by `p_author_id` (a member's saves
--        are private and are never listed), and
--     2. it applies the visibility rule the home feed already uses,
--        covering both of its scopes: a card is listed when it
--        `is_public` ("For You") or when the viewer is a member of
--        its community ("Your Communities").
--
-- Deploy note: pure addition — a new function only, no backfill and
-- no dropped objects. Safe to apply before or after the release
-- that starts calling it.
-- ============================================================

create or replace function public.get_member_feed_page(
  p_viewer_id uuid,
  p_author_id uuid,
  p_scope text default 'all',
  p_before timestamptz default null,
  p_limit integer default 30
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
    where m.user_id = p_viewer_id
  ), candidates as (
    select 'thread'::text as kind, t.id, t.community_id, t.user_id, t.created_at, to_jsonb(t) as payload
    from public.community_threads t
    where p_scope in ('all', 'thread')
      and t.user_id = p_author_id
      and t.community_id is not null
      and (t.is_public or t.community_id in (select community_id from my_communities))
      and (p_before is null or t.created_at < p_before)
    union all
    select 'event', e.id, e.community_id, e.user_id, e.created_at, to_jsonb(e)
    from public.community_events e
    where p_scope in ('all', 'event')
      and e.user_id = p_author_id
      and e.community_id is not null
      and (e.is_public or e.community_id in (select community_id from my_communities))
      and (p_before is null or e.created_at < p_before)
    union all
    select 'resource', r.id, r.community_id, r.user_id, r.created_at, to_jsonb(r)
    from public.community_resources r
    where p_scope in ('all', 'resource')
      and r.user_id = p_author_id
      and r.community_id is not null
      and (r.is_public or r.community_id in (select community_id from my_communities))
      and (p_before is null or r.created_at < p_before)
    union all
    select 'showcase', s.id, s.community_id, s.user_id, s.created_at, to_jsonb(s)
    from public.community_showcase_posts s
    where p_scope in ('all', 'showcase')
      and s.user_id = p_author_id
      and s.community_id is not null
      and (s.is_public or s.community_id in (select community_id from my_communities))
      and (p_before is null or s.created_at < p_before)
  ), page as (
    select * from candidates
    order by created_at desc, id desc
    limit least(greatest(p_limit, 1), 50)
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
    'user_liked', (p.kind = 'thread' and exists(select 1 from public.thread_likes x where x.thread_id = p.id and x.user_id = p_viewer_id))
      or (p.kind = 'event' and exists(select 1 from public.event_likes x where x.event_id = p.id and x.user_id = p_viewer_id))
      or (p.kind = 'showcase' and exists(select 1 from public.showcase_likes x where x.post_id = p.id and x.user_id = p_viewer_id)),
    'rsvp_count', case when p.kind = 'event' then (select count(*) from public.event_rsvps x where x.event_id = p.id) else 0 end,
    'user_rsvped', p.kind = 'event' and exists(select 1 from public.event_rsvps x where x.event_id = p.id and x.user_id = p_viewer_id),
    'save_count', case
      when p.kind = 'event' then (select count(*) from public.event_saves x where x.event_id = p.id)
      when p.kind = 'resource' then (select count(*) from public.resource_saves x where x.resource_id = p.id)
      when p.kind = 'showcase' then (select count(*) from public.showcase_saves x where x.post_id = p.id)
      else 0 end,
    'user_saved', case p.kind
      when 'thread' then exists(select 1 from public.thread_saves x where x.thread_id = p.id and x.user_id = p_viewer_id)
      when 'event' then exists(select 1 from public.event_saves x where x.event_id = p.id and x.user_id = p_viewer_id)
      when 'resource' then exists(select 1 from public.resource_saves x where x.resource_id = p.id and x.user_id = p_viewer_id)
      when 'showcase' then exists(select 1 from public.showcase_saves x where x.post_id = p.id and x.user_id = p_viewer_id)
    end,
    'bookmark_count', case when p.kind = 'resource' then (select count(*) from public.resource_bookmarks x where x.resource_id = p.id) else 0 end,
    'user_bookmarked', p.kind = 'resource' and exists(select 1 from public.resource_bookmarks x where x.resource_id = p.id and x.user_id = p_viewer_id)
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
  order by p.created_at desc, p.id desc;
$$;

comment on function public.get_member_feed_page(uuid, uuid, text, timestamptz, integer) is
  'Member profile activity: cards authored by p_author_id that p_viewer_id may see (public, or in a community the viewer belongs to), projected exactly like get_profile_feed_page with every interaction flag resolved for the viewer.';

revoke all on function public.get_member_feed_page(uuid, uuid, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.get_member_feed_page(uuid, uuid, text, timestamptz, integer) to service_role;
