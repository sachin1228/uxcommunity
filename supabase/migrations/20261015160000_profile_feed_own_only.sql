-- ============================================================
-- Profile activity: every tab lists what the member AUTHORED —
-- only the Saved tab lists saves
--
-- WHY
--   `get_profile_feed_page` served "own + saved" membership on every
--   scope: All and each kind tab unioned the cards the member
--   authored AND the cards they had saved, per kind. Cards another
--   member authored therefore showed up under tabs that read as
--   "my activity" on the member's own profile — a saved post sat
--   there with no save marker, looking exactly like a leak (and, in
--   production, worse: until 20261010170000 is applied, the saved
--   scopes read `resource_saves`, which is the resource card's
--   HEART — so merely liking a resource put it on the liker's
--   profile). Two members who liked/saved each other's test posts
--   saw each other's cards on their profiles; nothing crossed
--   accounts — the saves themselves were the leak.
--
-- WHAT
--   The candidate branches split cleanly:
--     * 'all' and the four kind scopes list authored cards only,
--       one index-driven branch per kind (owner index), exactly the
--       semantics `get_member_feed_page` already applies;
--     * the save tables feed the 'saved' scope alone, with the
--       bookmark semantics from 20261010170000 (a resource Save is
--       `resource_bookmarks`; `resource_saves` stays the card's
--       heart and is only projected as `user_saved`).
--   The projection also restores the master-data community display
--   picture (master row via `communities.reference_id`, stored
--   `communities.image_url` as fallback) that the home feed has
--   resolved since 20260925020000 and 20261010170000 accidentally
--   dropped — both feed RPCs must stay in lockstep; same payload,
--   same card components.
--
-- Deploy note: create-or-replace of one function, same signature,
-- so the grants survive. Pure read-path change — no schema change,
-- no backfill — and safe to apply whether or not
-- 20261010170000_profile_feed_saved_bookmarks.sql has run.
-- ============================================================

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
    -- ── Authored: 'all' and the kind scopes ────────────────────────────────
    -- One branch per kind, index-driven on (author, recency) — never a
    -- sequential scan of every card table.

    -- ── Threads ────────────────────────────────────────────────────────────
    select 'thread'::text as kind, t.id, t.community_id, t.user_id, t.created_at, to_jsonb(t) as payload
    from public.community_threads t
    where p_scope in ('all', 'thread') and t.user_id = p_user_id and t.community_id is not null
    union all
    -- ── Events ─────────────────────────────────────────────────────────────
    select 'event', e.id, e.community_id, e.user_id, e.created_at, to_jsonb(e)
    from public.community_events e
    where p_scope in ('all', 'event') and e.user_id = p_user_id and e.community_id is not null
    union all
    -- ── Resources ──────────────────────────────────────────────────────────
    select 'resource', r.id, r.community_id, r.user_id, r.created_at, to_jsonb(r)
    from public.community_resources r
    where p_scope in ('all', 'resource') and r.user_id = p_user_id and r.community_id is not null
    union all
    -- ── Showcase ───────────────────────────────────────────────────────────
    select 'showcase', p.id, p.community_id, p.user_id, p.created_at, to_jsonb(p)
    from public.community_showcase_posts p
    where p_scope in ('all', 'showcase') and p.user_id = p_user_id and p.community_id is not null
    union all
    -- ── Saved: the Saved tab alone ─────────────────────────────────────────
    -- The resource card's Save is the bookmark — resource_saves is the heart,
    -- and a heart is not a save (see 20261010170000).
    select 'thread', t.id, t.community_id, t.user_id, t.created_at, to_jsonb(t)
    from public.thread_saves s
    join public.community_threads t on t.id = s.thread_id
    where p_scope = 'saved' and s.user_id = p_user_id and t.community_id is not null
    union all
    select 'event', e.id, e.community_id, e.user_id, e.created_at, to_jsonb(e)
    from public.event_saves s
    join public.community_events e on e.id = s.event_id
    where p_scope = 'saved' and s.user_id = p_user_id and e.community_id is not null
    union all
    select 'resource', r.id, r.community_id, r.user_id, r.created_at, to_jsonb(r)
    from public.resource_bookmarks s
    join public.community_resources r on r.id = s.resource_id
    where p_scope = 'saved' and s.user_id = p_user_id and r.community_id is not null
    union all
    select 'showcase', p.id, p.community_id, p.user_id, p.created_at, to_jsonb(p)
    from public.showcase_saves s
    join public.community_showcase_posts p on p.id = s.post_id
    where p_scope = 'saved' and s.user_id = p_user_id and p.community_id is not null
  ), page as (
    select * from candidates
    where p_before is null or candidates.created_at < p_before
    order by created_at desc, id desc
    limit least(greatest(p_limit, 1), 50)
  )
  -- Projection mirrors public.get_home_feed_page exactly: the profile cards
  -- and the homepage cards are rendered by the same client components. The
  -- community display picture resolves the master-data row first (via
  -- communities.reference_id), stored communities.image_url as fallback.
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
  left join public.experience_levels experience
    on c.type = 'experience_level' and experience.id = c.reference_id
  left join public.job_titles job
    on c.type = 'job_title' and job.id = c.reference_id
  order by p.created_at desc, p.id desc;
$$;

comment on function public.get_profile_feed_page(uuid, text, timestamptz, integer) is
  'Profile activity: cards authored by p_user_id on all/kind scopes; the Saved scope lists what p_user_id saved (bookmarks for resources). Same card payload as get_home_feed_page with every interaction flag resolved for the member.';

revoke all on function public.get_profile_feed_page(uuid, text, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.get_profile_feed_page(uuid, text, timestamptz, integer) to service_role;
