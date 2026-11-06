-- Stage 4 AUD-P2 — the home feed sorts a UNION of four content tables.
--
-- Two problems this migration fixes:
--
--   1. Every branch scanned and sorted its whole table before the outer
--      `limit`, so the work grew with total content no matter how few cards
--      the page needed. Each branch is now bounded to the page size before the
--      UNION; the outer sort only ever sees page_size * 4 rows.
--   2. Pagination used `created_at < p_before` while the total order is
--      `(created_at desc, id desc)`. Rows sharing the boundary timestamp were
--      skipped between pages. The 5-argument overload adds the id half of the
--      cursor and makes the comparison exact.
--
-- The old 4-argument overload remains for clients that have not deployed the
-- id half yet; it keeps the old timestamp-only semantics.

create index idx_community_threads_created_id
  on public.community_threads (created_at desc, id desc);

create index idx_community_showcase_created_id
  on public.community_showcase_posts (created_at desc, id desc);

create index idx_community_events_created_id
  on public.community_events (created_at desc, id desc);

create index idx_community_events_public_created_id
  on public.community_events (created_at desc, id desc)
  where is_public = true and community_id is not null;

create index idx_community_resources_created_id
  on public.community_resources (created_at desc, id desc);

create index idx_community_resources_public_created_id
  on public.community_resources (created_at desc, id desc)
  where is_public = true and community_id is not null;

create index idx_community_showcase_public_created_id
  on public.community_showcase_posts (created_at desc, id desc)
  where is_public = true and community_id is not null;

create or replace function public.get_home_feed_page(
  p_user_id uuid,
  p_before timestamp with time zone,
  p_before_id uuid,
  p_limit integer,
  p_scope text
)
returns table (item jsonb)
language sql
stable
set search_path to ''
as $function$
  with my_communities as (
    select m.community_id
    from public.community_members m
    where m.user_id = p_user_id
  ), candidates as (
    (select 'thread'::text as kind, t.id, t.community_id, t.user_id, t.created_at, to_jsonb(t) as payload
     from public.community_threads t
     where t.community_id is not null
       and p_scope <> 'public'
       and t.community_id in (select community_id from my_communities)
       and (
         p_before is null
         or t.created_at < p_before
         or (p_before_id is not null and t.created_at = p_before and t.id < p_before_id)
       )
     order by t.created_at desc, t.id desc
     limit least(greatest(coalesce(p_limit, 30), 1), 30))
    union all
    (select 'thread', t.id, t.community_id, t.user_id, t.created_at, to_jsonb(t)
     from public.community_threads t
     where t.community_id is not null
       and p_scope <> 'communities'
       and t.is_public
       and t.community_id not in (select community_id from my_communities)
       and (
         p_before is null
         or t.created_at < p_before
         or (p_before_id is not null and t.created_at = p_before and t.id < p_before_id)
       )
     order by t.created_at desc, t.id desc
     limit least(greatest(coalesce(p_limit, 30), 1), 30))
    union all
    (select 'event', e.id, e.community_id, e.user_id, e.created_at, to_jsonb(e)
     from public.community_events e
     where e.community_id is not null
       and p_scope <> 'public'
       and e.community_id in (select community_id from my_communities)
       and (
         p_before is null
         or e.created_at < p_before
         or (p_before_id is not null and e.created_at = p_before and e.id < p_before_id)
       )
     order by e.created_at desc, e.id desc
     limit least(greatest(coalesce(p_limit, 30), 1), 30))
    union all
    (select 'event', e.id, e.community_id, e.user_id, e.created_at, to_jsonb(e)
     from public.community_events e
     where e.community_id is not null
       and p_scope <> 'communities'
       and e.is_public
       and e.community_id not in (select community_id from my_communities)
       and (
         p_before is null
         or e.created_at < p_before
         or (p_before_id is not null and e.created_at = p_before and e.id < p_before_id)
       )
     order by e.created_at desc, e.id desc
     limit least(greatest(coalesce(p_limit, 30), 1), 30))
    union all
    (select 'resource', r.id, r.community_id, r.user_id, r.created_at, to_jsonb(r)
     from public.community_resources r
     where r.community_id is not null
       and p_scope <> 'public'
       and r.community_id in (select community_id from my_communities)
       and (
         p_before is null
         or r.created_at < p_before
         or (p_before_id is not null and r.created_at = p_before and r.id < p_before_id)
       )
     order by r.created_at desc, r.id desc
     limit least(greatest(coalesce(p_limit, 30), 1), 30))
    union all
    (select 'resource', r.id, r.community_id, r.user_id, r.created_at, to_jsonb(r)
     from public.community_resources r
     where r.community_id is not null
       and p_scope <> 'communities'
       and r.is_public
       and r.community_id not in (select community_id from my_communities)
       and (
         p_before is null
         or r.created_at < p_before
         or (p_before_id is not null and r.created_at = p_before and r.id < p_before_id)
       )
     order by r.created_at desc, r.id desc
     limit least(greatest(coalesce(p_limit, 30), 1), 30))
    union all
    (select 'showcase', s.id, s.community_id, s.user_id, s.created_at, to_jsonb(s)
     from public.community_showcase_posts s
     where s.community_id is not null
       and p_scope <> 'public'
       and s.community_id in (select community_id from my_communities)
       and (
         p_before is null
         or s.created_at < p_before
         or (p_before_id is not null and s.created_at = p_before and s.id < p_before_id)
       )
     order by s.created_at desc, s.id desc
     limit least(greatest(coalesce(p_limit, 30), 1), 30))
    union all
    (select 'showcase', s.id, s.community_id, s.user_id, s.created_at, to_jsonb(s)
     from public.community_showcase_posts s
     where s.community_id is not null
       and p_scope <> 'communities'
       and s.is_public
       and s.community_id not in (select community_id from my_communities)
       and (
         p_before is null
         or s.created_at < p_before
         or (p_before_id is not null and s.created_at = p_before and s.id < p_before_id)
       )
     order by s.created_at desc, s.id desc
     limit least(greatest(coalesce(p_limit, 30), 1), 30))
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
$function$;

revoke all on function public.get_home_feed_page(uuid, timestamp with time zone, uuid, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_home_feed_page(uuid, timestamp with time zone, uuid, integer, text)
  to service_role;

comment on function public.get_home_feed_page(uuid, timestamp with time zone, uuid, integer, text)
  is 'Home feed page with a compound (created_at, id) keyset cursor. Each UNION branch is bounded to the page size before the outer sort.';
