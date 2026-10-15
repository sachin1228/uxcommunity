-- ============================================================
-- Migration: the Library — handpicked posts on a shelf of their own
--
-- WHY
--   /dashboard/library was a "Coming soon" placeholder. The member Library is a
--   curated cross-community shelf: the admin handpicks threads, showcase posts
--   and resources (mostly by engagement) and they appear there to browse. This
--   file is the whole feature's storage: which posts are on the shelf, in what
--   order, and the read functions that serve the admin queue and the member
--   page.
--
-- WHAT IT ADDS
--     library_items             — one row per picked post. Three nullable FKs
--                                 (thread / showcase / resource), exactly one
--                                 set, each `on delete cascade`, so a deleted
--                                 post silently leaves the shelf.
--     library_featured_renumber — closes rank gaps after a removal.
--     admin_library_candidates  — the pick queue: every post of a kind with
--                                 its engagement counts, ordered by engagement
--                                 or recency. Admin only.
--     admin_library_featured    — the shelf, in order. Admin only.
--     admin_set_library_item    — put a post on the shelf (at the end of its
--                                 kind's block) or take it off.
--     admin_move_library_item   — move a picked post one position.
--     get_library_page          — the member page's card payload, projected
--                                 exactly like get_member_feed_page so the
--                                 shelf renders through the same feed cards.
--
-- THE VISIBILITY RULE
--   A picked post is listed to a viewer when it `is_public` or the viewer is a
--   member of its community — the same rule the home feed and the member feed
--   already use. An admin pick puts a post on the shelf; it never widens who
--   may read the post itself.
--
-- NO TIMEZONE, NO BACKFILL
--   Ranks start empty; the shelf is built by the admin from the queue. Pure
--   addition — safe to apply before or after the release that starts calling
--   it (the queue simply reads empty until it exists).
-- ============================================================


-- ─── 1. The shelf ───────────────────────────────────────────

create table if not exists public.library_items (
  id            uuid primary key default gen_random_uuid(),
  -- Exactly one of the three content columns is set; `item_type` names which.
  -- The per-column unique constraints make a second pick of the same post
  -- impossible, and the cascades mean a deleted post leaves the shelf on its
  -- own — there is no orphan state to clean up.
  thread_id     uuid unique references public.community_threads (id) on delete cascade,
  showcase_id   uuid unique references public.community_showcase_posts (id) on delete cascade,
  resource_id   uuid unique references public.community_resources (id) on delete cascade,
  item_type     text generated always as (
                  case
                    when thread_id is not null then 'thread'
                    when showcase_id is not null then 'showcase'
                    else 'resource'
                  end
                ) stored,
  -- 1..N position within its kind's block, held by library_featured_renumber.
  -- Deliberately not unique: the move function swaps two ranks in place, and a
  -- transient duplicate is how it stays deadlock-free (same as companies).
  featured_rank integer not null check (featured_rank >= 1),
  -- Who put it on the shelf; the row outlives the admin account.
  curated_by    uuid references public.users (id) on delete set null,
  curated_at    timestamptz not null default now(),
  constraint library_items_one_kind
    check (num_nonnulls(thread_id, showcase_id, resource_id) = 1)
);

comment on table public.library_items is
  'The member Library shelf: threads, showcase posts and resources the admin featured, with a 1..N order per kind. A deleted post cascades its row away.';

create index if not exists idx_library_items_kind_rank
  on public.library_items (item_type, featured_rank);

alter table public.library_items enable row level security;
revoke all on table public.library_items from anon, authenticated;


-- ─── 2. Keeping each block 1..N ─────────────────────────────

-- A removal leaves a gap that nothing else would close: this rewrites one
-- kind's block as 1..N in the order it is currently in (rank, then curated_at,
-- then id — a total order, so equal ranks can never renumber arbitrarily).
--
-- Deliberately not granted to any API role: it is called from inside the admin
-- functions, which are SECURITY DEFINER.
create or replace function public.library_featured_renumber(p_type text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_moved integer;
begin
  if p_type is null or p_type not in ('thread', 'showcase', 'resource') then
    raise exception using errcode = '22023', message = 'invalid_type';
  end if;

  with ordered as (
    select
      li.id,
      row_number() over (order by li.featured_rank asc, li.curated_at asc, li.id asc) as position
    from public.library_items as li
    where li.item_type = p_type
  )
  update public.library_items as li
     set featured_rank = o.position
    from ordered as o
   where li.id = o.id
     and li.featured_rank is distinct from o.position;

  get diagnostics v_moved = row_count;
  return v_moved;
end;
$$;

comment on function public.library_featured_renumber(text) is
  'Rewrites one kind''s library block as 1..N in its current order, so the shelf has no gaps and no ties. Internal: executable by nobody through the API.';

revoke all on function public.library_featured_renumber(text) from public, anon, authenticated;


-- ─── 3. Featuring a post ────────────────────────────────────

-- Idempotent in both directions: featuring a post already on the shelf returns
-- its position and changes nothing, and unfeaturing one that is not on it is a
-- no-op. The UI can therefore retry a request safely.
create or replace function public.admin_set_library_item(
  p_type       text,
  p_id         uuid,
  p_featured   boolean,
  p_curated_by uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exists boolean;
  v_rank   integer;
begin
  if p_type is null or p_type not in ('thread', 'showcase', 'resource') then
    raise exception using errcode = '22023', message = 'invalid_type';
  end if;
  if p_featured is null then
    raise exception using errcode = '22023', message = 'featured_required';
  end if;

  select case p_type
           when 'thread'   then exists (select 1 from public.community_threads as t where t.id = p_id)
           when 'showcase' then exists (select 1 from public.community_showcase_posts as s where s.id = p_id)
           else                 exists (select 1 from public.community_resources as r where r.id = p_id)
         end
    into v_exists;

  if not v_exists then
    raise exception using errcode = 'P0002', message = 'item_not_found';
  end if;

  if not p_featured then
    delete from public.library_items as li
    where li.item_type = p_type
      and p_id in (li.thread_id, li.showcase_id, li.resource_id);
    perform public.library_featured_renumber(p_type);
    return null;
  end if;

  select li.featured_rank
    into v_rank
  from public.library_items as li
  where li.item_type = p_type
    and p_id in (li.thread_id, li.showcase_id, li.resource_id);

  if v_rank is null then
    select coalesce(max(li.featured_rank), 0) + 1
      into v_rank
    from public.library_items as li
    where li.item_type = p_type;

    insert into public.library_items
      (thread_id, showcase_id, resource_id, featured_rank, curated_by)
    values
      (case when p_type = 'thread' then p_id end,
       case when p_type = 'showcase' then p_id end,
       case when p_type = 'resource' then p_id end,
       v_rank,
       p_curated_by);
  end if;

  return v_rank;
end;
$$;

comment on function public.admin_set_library_item(text, uuid, boolean, uuid) is
  'Puts a post on the library shelf at the end of its kind''s block, or takes it off and closes the gap. Returns the position, or null once it is off. Service-role only.';

revoke all on function public.admin_set_library_item(text, uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.admin_set_library_item(text, uuid, boolean, uuid) to service_role;


-- ─── 4. Moving within a block ───────────────────────────────

-- p_direction is -1 for one position earlier, 1 for one position later. Moving
-- the first row earlier or the last row later is a no-op rather than an error:
-- the buttons are disabled at the ends, and a stale page should not turn a
-- harmless click into a failure.
create or replace function public.admin_move_library_item(
  p_type      text,
  p_id        uuid,
  p_direction integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item_id    uuid;
  v_rank       integer;
  v_neighbour  uuid;
  v_their_rank integer;
begin
  if p_type is null or p_type not in ('thread', 'showcase', 'resource') then
    raise exception using errcode = '22023', message = 'invalid_type';
  end if;
  if p_direction is null or p_direction not in (-1, 1) then
    raise exception using errcode = '22023', message = 'invalid_direction';
  end if;

  select li.id, li.featured_rank
    into v_item_id, v_rank
  from public.library_items as li
  where li.item_type = p_type
    and p_id in (li.thread_id, li.showcase_id, li.resource_id);

  if v_rank is null then
    -- Distinguish "not a post" from "not on the shelf" for the route's message.
    if not exists (
      select 1 from public.community_threads as t        where p_type = 'thread'   and t.id = p_id
      union all
      select 1 from public.community_showcase_posts as s where p_type = 'showcase' and s.id = p_id
      union all
      select 1 from public.community_resources as r      where p_type = 'resource' and r.id = p_id
    ) then
      raise exception using errcode = 'P0002', message = 'item_not_found';
    end if;
    raise exception using errcode = 'P0001', message = 'item_not_featured';
  end if;

  -- The neighbour is a POSITION away, not a rank away: ranks are 1..N while
  -- library_featured_renumber() has run, but the block is defined by its
  -- order, and a swap of two ranks keeps that order whatever the gaps are.
  with ordered as (
    select
      li.id,
      li.featured_rank as rank,
      row_number() over (order by li.featured_rank asc, li.curated_at asc, li.id asc) as position
    from public.library_items as li
    where li.item_type = p_type
  )
  select n.id, n.rank
    into v_neighbour, v_their_rank
  from ordered as m
  join ordered as n on n.position = m.position + p_direction
  where m.id = v_item_id;

  if v_neighbour is null then
    return v_rank;
  end if;

  -- No unique index on (item_type, featured_rank), so the intermediate
  -- duplicate is allowed and the two statements cannot deadlock themselves.
  update public.library_items as li set featured_rank = v_their_rank where li.id = v_item_id;
  update public.library_items as li set featured_rank = v_rank       where li.id = v_neighbour;

  return v_their_rank;
end;
$$;

comment on function public.admin_move_library_item(text, uuid, integer) is
  'Moves a shelf item one position within its kind (-1 earlier, 1 later) and returns its new position; a move off either end changes nothing. Service-role only.';

revoke all on function public.admin_move_library_item(text, uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_move_library_item(text, uuid, integer) to service_role;


-- ─── 5. Reading the shelf (admin) ───────────────────────────

-- The admin's "in the library" block: every picked post, kind then position,
-- with the display fields and the engagement counts the queue shows too.
create or replace function public.admin_library_featured()
returns table (
  item_type      text,
  item_id        uuid,
  -- Quoted: `position` is a keyword in the column-definition grammar.
  "position"     integer,
  title          text,
  category       text,
  community_name text,
  author_name    text,
  is_public      boolean,
  like_count     bigint,
  comment_count  bigint,
  created_at     timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'thread'::text, t.id, li.featured_rank, t.title, t.category,
         c.name, u.name, t.is_public,
         (select count(*) from public.thread_likes as x where x.thread_id = t.id),
         (select count(*) from public.thread_comments as x where x.thread_id = t.id),
         t.created_at
  from public.library_items as li
  join public.community_threads as t on t.id = li.thread_id
  left join public.communities as c on c.id = t.community_id
  left join public.users as u on u.id = t.user_id
  union all
  select 'showcase', s.id, li.featured_rank, s.title, s.category,
         c.name, u.name, s.is_public,
         (select count(*) from public.showcase_likes as x where x.post_id = s.id),
         (select count(*) from public.showcase_comments as x where x.post_id = s.id),
         s.created_at
  from public.library_items as li
  join public.community_showcase_posts as s on s.id = li.showcase_id
  left join public.communities as c on c.id = s.community_id
  left join public.users as u on u.id = s.user_id
  union all
  select 'resource', r.id, li.featured_rank, r.title, r.resource_type,
         c.name, u.name, r.is_public,
         (select count(*) from public.resource_saves as x where x.resource_id = r.id),
         (select count(*) from public.resource_comments as x where x.resource_id = r.id),
         r.created_at
  from public.library_items as li
  join public.community_resources as r on r.id = li.resource_id
  left join public.communities as c on c.id = r.community_id
  left join public.users as u on u.id = r.user_id
  order by 1 asc, 3 asc;
$$;

comment on function public.admin_library_featured() is
  'Every post on the library shelf, in kind then position order, with its community, author and engagement counts. Service-role only.';

revoke all on function public.admin_library_featured() from public, anon, authenticated;
grant execute on function public.admin_library_featured() to service_role;


-- ─── 6. The pick queue (admin) ──────────────────────────────

-- One kind at a time: every post of that kind with its engagement counts and
-- whether it is already on the shelf. `engagement` sorts by likes + comments
-- (resources: saves + comments — the heart their cards count); `newest` sorts
-- by recency. Community-less posts (public-feed posts with no community) are
-- left out: they cannot render on the shelf, so they are not candidates.
create or replace function public.admin_library_candidates(
  p_kind   text,
  p_search text    default '',
  p_sort   text    default 'engagement',
  p_offset integer default 0,
  p_limit  integer default 25
)
returns table (
  id             uuid,
  title          text,
  category       text,
  community_name text,
  author_name    text,
  is_public      boolean,
  created_at     timestamptz,
  like_count     bigint,
  comment_count  bigint,
  featured       boolean,
  total_count    bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
    select 'thread'::text as kind, t.id, t.title, t.category,
           c.name as community_name, u.name as author_name, t.is_public, t.created_at,
           (select count(*) from public.thread_likes as x where x.thread_id = t.id) as like_count,
           (select count(*) from public.thread_comments as x where x.thread_id = t.id) as comment_count,
           (li.id is not null) as featured
    from public.community_threads as t
    left join public.communities as c on c.id = t.community_id
    left join public.users as u on u.id = t.user_id
    left join public.library_items as li on li.thread_id = t.id
    where p_kind = 'thread'
      and t.community_id is not null
      and (coalesce(p_search, '') = ''
           or t.title ilike '%' || p_search || '%'
           or coalesce(u.name, '') ilike '%' || p_search || '%')
    union all
    select 'showcase', s.id, s.title, s.category,
           c.name, u.name, s.is_public, s.created_at,
           (select count(*) from public.showcase_likes as x where x.post_id = s.id),
           (select count(*) from public.showcase_comments as x where x.post_id = s.id),
           (li.id is not null)
    from public.community_showcase_posts as s
    left join public.communities as c on c.id = s.community_id
    left join public.users as u on u.id = s.user_id
    left join public.library_items as li on li.showcase_id = s.id
    where p_kind = 'showcase'
      and s.community_id is not null
      and (coalesce(p_search, '') = ''
           or s.title ilike '%' || p_search || '%'
           or coalesce(u.name, '') ilike '%' || p_search || '%')
    union all
    select 'resource', r.id, r.title, r.resource_type,
           c.name, u.name, r.is_public, r.created_at,
           (select count(*) from public.resource_saves as x where x.resource_id = r.id),
           (select count(*) from public.resource_comments as x where x.resource_id = r.id),
           (li.id is not null)
    from public.community_resources as r
    left join public.communities as c on c.id = r.community_id
    left join public.users as u on u.id = r.user_id
    left join public.library_items as li on li.resource_id = r.id
    where p_kind = 'resource'
      and r.community_id is not null
      and (coalesce(p_search, '') = ''
           or r.title ilike '%' || p_search || '%'
           or coalesce(u.name, '') ilike '%' || p_search || '%')
  ),
  ranked as (
    select candidates.*, count(*) over () as total_count
    from candidates
  )
  select id, title, category, community_name, author_name, is_public, created_at,
         like_count, comment_count, featured, total_count
  from ranked
  order by
    case when p_sort = 'newest' then created_at end desc nulls last,
    like_count + comment_count desc,
    created_at desc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
$$;

comment on function public.admin_library_candidates(text, text, text, integer, integer) is
  'The library pick queue: every post of one kind with its engagement counts and shelf flag, ordered by engagement (likes + comments; resources: saves + comments) or recency. Service-role only.';

revoke all on function public.admin_library_candidates(text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_library_candidates(text, text, text, integer, integer) to service_role;


-- ─── 7. Reading the shelf (member page) ─────────────────────

-- The member Library page: every picked post the viewer may see — public, or
-- from a community they belong to — projected exactly like
-- get_member_feed_page, so the shelf renders through the same feed cards as
-- the home feed and the profile tabs (same counts, same viewer flags).
create or replace function public.get_library_page(p_user_id uuid)
returns table (item jsonb)
language sql
stable
security invoker
set search_path = ''
as $$
  with my_communities as (
    select m.community_id
    from public.community_members as m
    where m.user_id = p_user_id
  ), candidates as (
    select 'thread'::text as kind, t.id, t.community_id, t.user_id, t.created_at,
           li.featured_rank as rank, to_jsonb(t) as payload
    from public.library_items as li
    join public.community_threads as t on t.id = li.thread_id
    where t.community_id is not null
      and (t.is_public or t.community_id in (select community_id from my_communities))
    union all
    select 'showcase', s.id, s.community_id, s.user_id, s.created_at, li.featured_rank, to_jsonb(s)
    from public.library_items as li
    join public.community_showcase_posts as s on s.id = li.showcase_id
    where s.community_id is not null
      and (s.is_public or s.community_id in (select community_id from my_communities))
    union all
    select 'resource', r.id, r.community_id, r.user_id, r.created_at, li.featured_rank, to_jsonb(r)
    from public.library_items as li
    join public.community_resources as r on r.id = li.resource_id
    where r.community_id is not null
      and (r.is_public or r.community_id in (select community_id from my_communities))
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
      when 'thread'   then (select count(*) from public.thread_comments as x where x.thread_id = p.id)
      when 'resource' then (select count(*) from public.resource_comments as x where x.resource_id = p.id)
      when 'showcase' then (select count(*) from public.showcase_comments as x where x.post_id = p.id)
    end,
    'like_count', case
      when p.kind = 'thread' then (select count(*) from public.thread_likes as x where x.thread_id = p.id)
      when p.kind = 'showcase' then (select count(*) from public.showcase_likes as x where x.post_id = p.id)
      else 0 end,
    'user_liked', (p.kind = 'thread' and exists(select 1 from public.thread_likes as x where x.thread_id = p.id and x.user_id = p_user_id))
      or (p.kind = 'showcase' and exists(select 1 from public.showcase_likes as x where x.post_id = p.id and x.user_id = p_user_id)),
    'save_count', case
      when p.kind = 'resource' then (select count(*) from public.resource_saves as x where x.resource_id = p.id)
      when p.kind = 'showcase' then (select count(*) from public.showcase_saves as x where x.post_id = p.id)
      else 0 end,
    'user_saved', case p.kind
      when 'thread'   then exists(select 1 from public.thread_saves as x where x.thread_id = p.id and x.user_id = p_user_id)
      when 'resource' then exists(select 1 from public.resource_saves as x where x.resource_id = p.id and x.user_id = p_user_id)
      when 'showcase' then exists(select 1 from public.showcase_saves as x where x.post_id = p.id and x.user_id = p_user_id)
    end,
    'bookmark_count', case when p.kind = 'resource' then (select count(*) from public.resource_bookmarks as x where x.resource_id = p.id) else 0 end,
    'user_bookmarked', p.kind = 'resource' and exists(select 1 from public.resource_bookmarks as x where x.resource_id = p.id and x.user_id = p_user_id)
  )
  from candidates as p
  left join public.users as u on u.id = p.user_id
  left join public.designer_profiles as dp on dp.user_id = p.user_id
  left join public.communities as c on c.id = p.community_id
  left join public.cities as city
    on c.type = 'city' and city.id = c.reference_id
  left join public.design_sectors as sector
    on c.type = 'sector' and sector.id = c.reference_id
  left join public.experience_levels as experience
    on c.type = 'experience_level' and experience.id = c.reference_id
  left join public.job_titles as job
    on c.type = 'job_title' and job.id = c.reference_id
  order by case p.kind when 'thread' then 0 when 'showcase' then 1 else 2 end,
           p.rank asc,
           p.created_at desc;
$$;

comment on function public.get_library_page(uuid) is
  'The member Library shelf: every picked post p_user_id may see (public, or in a community they belong to), projected exactly like get_member_feed_page with every interaction flag resolved for the viewer, ordered by kind then shelf position.';

revoke all on function public.get_library_page(uuid) from public, anon, authenticated;
grant execute on function public.get_library_page(uuid) to service_role;
