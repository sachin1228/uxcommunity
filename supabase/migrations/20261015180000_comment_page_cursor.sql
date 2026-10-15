-- ============================================================
-- Comment lists — a bounded page per content kind, continued with a
--                  compound (created_at, id) cursor.
--
-- WHY
--   Every comment surface read its WHOLE list on every request:
--
--     * the four GET routes selected `… from <kind>_comments where <fk> = $1`
--       with no limit, on every mount, every realtime "comment" broadcast and
--       every revalidation;
--     * the four detail pages made the same read again for the server-rendered
--       first paint.
--
--   A comment row is small, but the cost was never the row — it was the
--   UNBOUNDEDNESS. A thread with 5,000 comments transferred all 5,000 (and then
--   the author resolver looked up every distinct author among them) to draw the
--   twenty a reader looks at, and it did so again on each of those events.
--   docs/supabase-egress-audit.md §6 is the item; a popular thread is the same
--   shape of problem the chat page's message list already had.
--
-- SHAPE OF THE FIX
--   Four functions, one per kind, all with the same contract:
--
--     get_thread_comment_page(p_thread_id, p_limit, p_before, p_before_id)
--     get_resource_comment_page(p_resource_id, …)
--     get_showcase_comment_page(p_post_id, …)
--     get_event_comment_page(p_event_id, …)
--
--   A page is a window of TOP-LEVEL comments (`parent_id is null`), newest
--   first, ordered by `(created_at desc, id desc)` and continued with the
--   matching id tiebreak — the same compound cursor
--   20261013100000_community_message_compound_cursor.sql introduced for the
--   chat, for the same reason: a plain timestamp bound can split a burst that
--   shares one timestamp and lose comments between pages.
--
--   The window's REPLIES come with it, in full. Replies are one level deep
--   (a reply cannot be replied to), they are rate-limited per content item and
--   per minute exactly like roots, and a thread that showed a comment without
--   the answers under it would be worse than the read it replaces. The
--   unbounded dimension — the number of top-level comments — is the one this
--   migration bounds. If a single root's reply count ever becomes a problem,
--   paging replies is a separate change with its own UI ("View more replies").
--
--   Every row of the page carries the comment; the PAGE-LEVEL values ride once,
--   on the first row, exactly like `content_reactions` and `authors` on the chat
--   page (20260928170000 / 20261015170000) — a per-row copy of the count and the
--   cursor would grow the payload with the page size:
--
--     total_count    the item's comment count, ROOTS AND REPLIES — the same
--                    number the cards already show as `comment_count`
--                    (a `count(*)` head request today), so the two agree;
--     has_more       whether a further page exists;
--     next_before,   the cursor to ask for it with — the oldest root on this
--     next_before_id page, and NULL when has_more is false.
--
--   Rows are returned oldest first (the display order the clients already
--   receive), so a caller nests replies under their parent exactly as before and
--   an un-paged first page is byte-for-byte the read it replaces.
--
-- INDEXES
--   No new index. Each table already has `(<fk>, created_at)`
--   (20260726000002, 20260726200002, 20260812190000, 20260813000001), which
--   serves both the backward scan of a newest-first page and the row-value
--   comparison of the cursor; `parent_id is null` is a cheap filter over that
--   scan, and the replies of a page come from the existing partial index on
--   `parent_id`.
--
-- DEPLOYMENT ORDER
--   Migration first, as always — but for this pair the order is forgiving. The
--   application treats a missing function as an un-migrated database and falls
--   back to the previous unbounded read
--   (apps/web/lib/communities/comment-pages.ts, the same "not installed" codes
--   comment-reactions.ts uses), so an app build deployed first serves correct
--   pages, just not bounded ones, until the migration lands.
--
-- COST
--   Four `create function` statements. No table rewrite, no lock on data.
-- ============================================================

-- ─── 1. Threads ─────────────────────────────────────────────────────────────

create or replace function public.get_thread_comment_page(
  p_thread_id uuid,
  -- Clamped to 1..50 below, so a caller cannot ask for an unbounded page even
  -- by accident.
  p_limit integer default 20,
  -- Both halves of the cursor travel together; a NULL id degrades to the
  -- all-ones sentinel, which can only re-include equal-timestamp rows.
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  thread_id uuid,
  user_id uuid,
  parent_id uuid,
  body text,
  created_at timestamptz,
  updated_at timestamptz,
  total_count integer,
  has_more boolean,
  next_before timestamptz,
  next_before_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select least(greatest(coalesce(p_limit, 20), 1), 50) as page_size
  ),
  -- One row more than the page, so `has_more` needs no second count.
  root_probe as materialized (
    select comment.id, comment.created_at
    from public.thread_comments as comment
    where comment.thread_id = p_thread_id
      and comment.parent_id is null
      and (p_before is null
           or (comment.created_at, comment.id)
                < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by comment.created_at desc, comment.id desc
    limit (select page_size + 1 from bounds)
  ),
  page_roots as materialized (
    select root.id, root.created_at
    from root_probe as root
    order by root.created_at desc, root.id desc
    limit (select page_size from bounds)
  ),
  -- The page's roots AND every reply under them.
  page_rows as materialized (
    select comment.id, comment.thread_id, comment.user_id, comment.parent_id,
      comment.body, comment.created_at, comment.updated_at
    from public.thread_comments as comment
    where comment.id in (select root.id from page_roots as root)
       or comment.parent_id in (select root.id from page_roots as root)
  ),
  page_meta as (
    select
      (select count(*)::integer from public.thread_comments as all_rows
        where all_rows.thread_id = p_thread_id) as total_count,
      (select count(*) from root_probe) > (select page_size from bounds) as has_more,
      (select root.created_at from page_roots as root
        order by root.created_at asc, root.id asc limit 1) as next_before,
      (select root.id from page_roots as root
        order by root.created_at asc, root.id asc limit 1) as next_before_id
  ),
  ordered as (
    select page_rows.*,
      row_number() over (order by page_rows.created_at asc, page_rows.id asc) as row_number
    from page_rows
  )
  select
    ordered.id, ordered.thread_id, ordered.user_id, ordered.parent_id,
    ordered.body, ordered.created_at, ordered.updated_at,
    case when ordered.row_number = 1 then page_meta.total_count end as total_count,
    case when ordered.row_number = 1 then page_meta.has_more end as has_more,
    case when ordered.row_number = 1 and page_meta.has_more then page_meta.next_before end as next_before,
    case when ordered.row_number = 1 and page_meta.has_more then page_meta.next_before_id end as next_before_id
  from ordered cross join page_meta
  order by ordered.created_at asc, ordered.id asc;
$$;

revoke all on function public.get_thread_comment_page(uuid, integer, timestamptz, uuid) from public;
revoke all on function public.get_thread_comment_page(uuid, integer, timestamptz, uuid) from anon;
revoke all on function public.get_thread_comment_page(uuid, integer, timestamptz, uuid) from authenticated;
grant execute on function public.get_thread_comment_page(uuid, integer, timestamptz, uuid) to service_role;

-- ─── 2. Resources ───────────────────────────────────────────────────────────

create or replace function public.get_resource_comment_page(
  p_resource_id uuid,
  p_limit integer default 20,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  resource_id uuid,
  user_id uuid,
  parent_id uuid,
  body text,
  created_at timestamptz,
  updated_at timestamptz,
  total_count integer,
  has_more boolean,
  next_before timestamptz,
  next_before_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select least(greatest(coalesce(p_limit, 20), 1), 50) as page_size
  ),
  root_probe as materialized (
    select comment.id, comment.created_at
    from public.resource_comments as comment
    where comment.resource_id = p_resource_id
      and comment.parent_id is null
      and (p_before is null
           or (comment.created_at, comment.id)
                < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by comment.created_at desc, comment.id desc
    limit (select page_size + 1 from bounds)
  ),
  page_roots as materialized (
    select root.id, root.created_at
    from root_probe as root
    order by root.created_at desc, root.id desc
    limit (select page_size from bounds)
  ),
  page_rows as materialized (
    select comment.id, comment.resource_id, comment.user_id, comment.parent_id,
      comment.body, comment.created_at, comment.updated_at
    from public.resource_comments as comment
    where comment.id in (select root.id from page_roots as root)
       or comment.parent_id in (select root.id from page_roots as root)
  ),
  page_meta as (
    select
      (select count(*)::integer from public.resource_comments as all_rows
        where all_rows.resource_id = p_resource_id) as total_count,
      (select count(*) from root_probe) > (select page_size from bounds) as has_more,
      (select root.created_at from page_roots as root
        order by root.created_at asc, root.id asc limit 1) as next_before,
      (select root.id from page_roots as root
        order by root.created_at asc, root.id asc limit 1) as next_before_id
  ),
  ordered as (
    select page_rows.*,
      row_number() over (order by page_rows.created_at asc, page_rows.id asc) as row_number
    from page_rows
  )
  select
    ordered.id, ordered.resource_id, ordered.user_id, ordered.parent_id,
    ordered.body, ordered.created_at, ordered.updated_at,
    case when ordered.row_number = 1 then page_meta.total_count end as total_count,
    case when ordered.row_number = 1 then page_meta.has_more end as has_more,
    case when ordered.row_number = 1 and page_meta.has_more then page_meta.next_before end as next_before,
    case when ordered.row_number = 1 and page_meta.has_more then page_meta.next_before_id end as next_before_id
  from ordered cross join page_meta
  order by ordered.created_at asc, ordered.id asc;
$$;

revoke all on function public.get_resource_comment_page(uuid, integer, timestamptz, uuid) from public;
revoke all on function public.get_resource_comment_page(uuid, integer, timestamptz, uuid) from anon;
revoke all on function public.get_resource_comment_page(uuid, integer, timestamptz, uuid) from authenticated;
grant execute on function public.get_resource_comment_page(uuid, integer, timestamptz, uuid) to service_role;

-- ─── 3. Showcase ────────────────────────────────────────────────────────────
-- The showcase table names its foreign key `post_id`, so this function does too.

create or replace function public.get_showcase_comment_page(
  p_post_id uuid,
  p_limit integer default 20,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  post_id uuid,
  user_id uuid,
  parent_id uuid,
  body text,
  created_at timestamptz,
  updated_at timestamptz,
  total_count integer,
  has_more boolean,
  next_before timestamptz,
  next_before_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select least(greatest(coalesce(p_limit, 20), 1), 50) as page_size
  ),
  root_probe as materialized (
    select comment.id, comment.created_at
    from public.showcase_comments as comment
    where comment.post_id = p_post_id
      and comment.parent_id is null
      and (p_before is null
           or (comment.created_at, comment.id)
                < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by comment.created_at desc, comment.id desc
    limit (select page_size + 1 from bounds)
  ),
  page_roots as materialized (
    select root.id, root.created_at
    from root_probe as root
    order by root.created_at desc, root.id desc
    limit (select page_size from bounds)
  ),
  page_rows as materialized (
    select comment.id, comment.post_id, comment.user_id, comment.parent_id,
      comment.body, comment.created_at, comment.updated_at
    from public.showcase_comments as comment
    where comment.id in (select root.id from page_roots as root)
       or comment.parent_id in (select root.id from page_roots as root)
  ),
  page_meta as (
    select
      (select count(*)::integer from public.showcase_comments as all_rows
        where all_rows.post_id = p_post_id) as total_count,
      (select count(*) from root_probe) > (select page_size from bounds) as has_more,
      (select root.created_at from page_roots as root
        order by root.created_at asc, root.id asc limit 1) as next_before,
      (select root.id from page_roots as root
        order by root.created_at asc, root.id asc limit 1) as next_before_id
  ),
  ordered as (
    select page_rows.*,
      row_number() over (order by page_rows.created_at asc, page_rows.id asc) as row_number
    from page_rows
  )
  select
    ordered.id, ordered.post_id, ordered.user_id, ordered.parent_id,
    ordered.body, ordered.created_at, ordered.updated_at,
    case when ordered.row_number = 1 then page_meta.total_count end as total_count,
    case when ordered.row_number = 1 then page_meta.has_more end as has_more,
    case when ordered.row_number = 1 and page_meta.has_more then page_meta.next_before end as next_before,
    case when ordered.row_number = 1 and page_meta.has_more then page_meta.next_before_id end as next_before_id
  from ordered cross join page_meta
  order by ordered.created_at asc, ordered.id asc;
$$;

revoke all on function public.get_showcase_comment_page(uuid, integer, timestamptz, uuid) from public;
revoke all on function public.get_showcase_comment_page(uuid, integer, timestamptz, uuid) from anon;
revoke all on function public.get_showcase_comment_page(uuid, integer, timestamptz, uuid) from authenticated;
grant execute on function public.get_showcase_comment_page(uuid, integer, timestamptz, uuid) to service_role;

-- ─── 4. Events ──────────────────────────────────────────────────────────────
-- The only kind whose comments can carry an image (20260726200003), so its page
-- returns `image_url` too — the same column list the route selected before.

create or replace function public.get_event_comment_page(
  p_event_id uuid,
  p_limit integer default 20,
  p_before timestamptz default null,
  p_before_id uuid default null
)
returns table (
  id uuid,
  event_id uuid,
  user_id uuid,
  parent_id uuid,
  body text,
  image_url text,
  created_at timestamptz,
  updated_at timestamptz,
  total_count integer,
  has_more boolean,
  next_before timestamptz,
  next_before_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with bounds as (
    select least(greatest(coalesce(p_limit, 20), 1), 50) as page_size
  ),
  root_probe as materialized (
    select comment.id, comment.created_at
    from public.event_comments as comment
    where comment.event_id = p_event_id
      and comment.parent_id is null
      and (p_before is null
           or (comment.created_at, comment.id)
                < (p_before, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
    order by comment.created_at desc, comment.id desc
    limit (select page_size + 1 from bounds)
  ),
  page_roots as materialized (
    select root.id, root.created_at
    from root_probe as root
    order by root.created_at desc, root.id desc
    limit (select page_size from bounds)
  ),
  page_rows as materialized (
    select comment.id, comment.event_id, comment.user_id, comment.parent_id,
      comment.body, comment.image_url, comment.created_at, comment.updated_at
    from public.event_comments as comment
    where comment.id in (select root.id from page_roots as root)
       or comment.parent_id in (select root.id from page_roots as root)
  ),
  page_meta as (
    select
      (select count(*)::integer from public.event_comments as all_rows
        where all_rows.event_id = p_event_id) as total_count,
      (select count(*) from root_probe) > (select page_size from bounds) as has_more,
      (select root.created_at from page_roots as root
        order by root.created_at asc, root.id asc limit 1) as next_before,
      (select root.id from page_roots as root
        order by root.created_at asc, root.id asc limit 1) as next_before_id
  ),
  ordered as (
    select page_rows.*,
      row_number() over (order by page_rows.created_at asc, page_rows.id asc) as row_number
    from page_rows
  )
  select
    ordered.id, ordered.event_id, ordered.user_id, ordered.parent_id,
    ordered.body, ordered.image_url, ordered.created_at, ordered.updated_at,
    case when ordered.row_number = 1 then page_meta.total_count end as total_count,
    case when ordered.row_number = 1 then page_meta.has_more end as has_more,
    case when ordered.row_number = 1 and page_meta.has_more then page_meta.next_before end as next_before,
    case when ordered.row_number = 1 and page_meta.has_more then page_meta.next_before_id end as next_before_id
  from ordered cross join page_meta
  order by ordered.created_at asc, ordered.id asc;
$$;

revoke all on function public.get_event_comment_page(uuid, integer, timestamptz, uuid) from public;
revoke all on function public.get_event_comment_page(uuid, integer, timestamptz, uuid) from anon;
revoke all on function public.get_event_comment_page(uuid, integer, timestamptz, uuid) from authenticated;
grant execute on function public.get_event_comment_page(uuid, integer, timestamptz, uuid) to service_role;
