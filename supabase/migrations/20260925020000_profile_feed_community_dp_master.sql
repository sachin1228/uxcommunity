-- The profile feed's cards must carry the community's LIVE display picture —
-- the exact resolution the home feed RPC now uses (see
-- 20260925010000_feed_community_dp_master.sql): master-data row first via
-- communities.reference_id, stored communities.image_url as fallback.
--
-- Both feed RPCs must stay in lockstep: the profile cards and the homepage
-- cards are rendered by the same client components.

create or replace function public.get_profile_feed_page(
  p_user_id uuid,
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
  with candidates as (
    -- Own posts and saved posts are two separate branches per kind so each one
    -- stays index-driven (owner index / save index + primary key) instead of
    -- degrading into a sequential scan of every card table.

    -- ── Threads ────────────────────────────────────────────────────────────
    select 'thread'::text as kind, t.id, t.community_id, t.user_id, t.created_at, to_jsonb(t) as payload
    from public.community_threads t
    where p_scope in ('all', 'thread') and t.user_id = p_user_id and t.community_id is not null
    union all
    -- A post the member saved themselves is already covered by the branch
    -- above, except on the Saved scope — which is exactly the saved set and
    -- therefore has to include it.
    select 'thread', t.id, t.community_id, t.user_id, t.created_at, to_jsonb(t)
    from public.thread_saves s
    join public.community_threads t on t.id = s.thread_id
    where p_scope in ('all', 'thread', 'saved') and s.user_id = p_user_id
      and (p_scope = 'saved' or t.user_id <> p_user_id) and t.community_id is not null
    union all
    -- ── Events ─────────────────────────────────────────────────────────────
    select 'event', e.id, e.community_id, e.user_id, e.created_at, to_jsonb(e)
    from public.community_events e
    where p_scope in ('all', 'event') and e.user_id = p_user_id and e.community_id is not null
    union all
    select 'event', e.id, e.community_id, e.user_id, e.created_at, to_jsonb(e)
    from public.event_saves s
    join public.community_events e on e.id = s.event_id
    where p_scope in ('all', 'event', 'saved') and s.user_id = p_user_id
      and (p_scope = 'saved' or e.user_id <> p_user_id) and e.community_id is not null
    union all
    -- ── Resources ──────────────────────────────────────────────────────────
    select 'resource', r.id, r.community_id, r.user_id, r.created_at, to_jsonb(r)
    from public.community_resources r
    where p_scope in ('all', 'resource') and r.user_id = p_user_id and r.community_id is not null
    union all
    select 'resource', r.id, r.community_id, r.user_id, r.created_at, to_jsonb(r)
    from public.resource_saves s
    join public.community_resources r on r.id = s.resource_id
    where p_scope in ('all', 'resource', 'saved') and s.user_id = p_user_id
      and (p_scope = 'saved' or r.user_id <> p_user_id) and r.community_id is not null
    union all
    -- ── Showcase ───────────────────────────────────────────────────────────
    select 'showcase', p.id, p.community_id, p.user_id, p.created_at, to_jsonb(p)
    from public.community_showcase_posts p
    where p_scope in ('all', 'showcase') and p.user_id = p_user_id and p.community_id is not null
    union all
    select 'showcase', p.id, p.community_id, p.user_id, p.created_at, to_jsonb(p)
    from public.showcase_saves s
    join public.community_showcase_posts p on p.id = s.post_id
    where p_scope in ('all', 'showcase', 'saved') and s.user_id = p_user_id
      and (p_scope = 'saved' or p.user_id <> p_user_id) and p.community_id is not null
  ), page as (
    select * from candidates
    where p_before is null or candidates.created_at < p_before
    order by created_at desc, id desc
    limit least(greatest(p_limit, 1), 50)
  )
  -- Projection mirrors public.get_home_feed_page exactly: the profile cards and
  -- the homepage cards are rendered by the same client components.
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

revoke all on function public.get_profile_feed_page(uuid, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.get_profile_feed_page(uuid, text, timestamptz, integer) to service_role;
