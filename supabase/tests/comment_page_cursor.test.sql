-- ============================================================================
-- Comment pages: a comment list costs a PAGE, not the thread
--
-- Every comment surface used to read its whole list on every request
-- (docs/supabase-egress-audit.md §6). The four functions this file covers
-- (20261015180000_comment_page_cursor) return a window of TOP-LEVEL comments —
-- newest first, continued with a compound (created_at, id) cursor — with the
-- replies of those comments, the item's total count, and the cursor for the
-- next page.
--
-- The properties that make the bound safe, and that this file pins:
--   * a page holds the newest roots and nothing older than its cursor;
--   * the roots of two consecutive pages are disjoint and together cover the
--     list exactly once — the cursor never loses or repeats a comment;
--   * a root's replies travel with it, so a page never renders a comment
--     without its answers;
--   * the total count is the whole list (roots AND replies), which is the
--     number the cards show as `comment_count`;
--   * the PAGE-LEVEL values (count, cursor) ride on one row, so the payload
--     cannot grow with the page size;
--   * `p_limit` is clamped, so no caller can ask for an unbounded page.
--
-- Fixtures are inserted inside a transaction and rolled back.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- ─── Contract ───────────────────────────────────────────────────────────────

select has_function('public', 'get_thread_comment_page', array['uuid', 'integer', 'timestamp with time zone', 'uuid']);
select has_function('public', 'get_resource_comment_page', array['uuid', 'integer', 'timestamp with time zone', 'uuid']);
select has_function('public', 'get_showcase_comment_page', array['uuid', 'integer', 'timestamp with time zone', 'uuid']);
select has_function('public', 'get_event_comment_page', array['uuid', 'integer', 'timestamp with time zone', 'uuid']);

-- ─── Fixtures ───────────────────────────────────────────────────────────────

create temporary table fixture_viewer as
select community_id, user_id
from public.community_members
order by joined_at
limit 1;

create temporary table fixture_reply_author as
select id as user_id
from public.users
where id <> (select user_id from fixture_viewer)
order by id
limit 1;

create temporary table fixture_thread as
with inserted as (
  insert into public.community_threads (community_id, user_id, title, category)
  values (
    (select community_id from fixture_viewer),
    (select user_id from fixture_viewer),
    'comment page fixture thread',
    'discussion'
  )
  returning id
) select id from inserted;

-- 60 top-level comments, one millisecond apart, so paging needs several pages
-- and every boundary has a distinct (created_at, id).
create temporary table fixture_roots as
with inserted as (
  insert into public.thread_comments (thread_id, user_id, body, created_at)
  select
    (select id from fixture_thread),
    (select user_id from fixture_viewer),
    'root ' || series.value,
    timestamp with time zone '2026-01-01 00:00:00+00' + series.value * interval '1 millisecond'
  from generate_series(1, 60) as series(value)
  returning id, body, created_at
)
select id, body, created_at, row_number() over (order by created_at) as position
from inserted;

-- Three replies under the OLDEST root, so they can only appear on the last page.
insert into public.thread_comments (thread_id, user_id, parent_id, body, created_at)
select
  (select id from fixture_thread),
  (select user_id from fixture_reply_author),
  (select id from fixture_roots where position = 1),
  'reply ' || series.value,
  timestamp with time zone '2026-01-01 00:01:00+00' + series.value * interval '1 millisecond'
from generate_series(1, 3) as series(value);

-- ─── The newest page ────────────────────────────────────────────────────────

create temporary table page_one as
select * from public.get_thread_comment_page((select id from fixture_thread), 3);

select is((select count(*)::integer from page_one), 3, 'a page of 3 holds 3 comments');
select is(
  (select count(*)::integer from page_one where parent_id is null),
  3,
  'the newest page is top-level comments: the oldest root''s replies are not in it'
);
select is(
  (select distinct total_count::integer from page_one where total_count is not null),
  63,
  'the total is the whole list — 60 roots and their 3 replies'
);
select is(
  (select distinct has_more from page_one where has_more is not null),
  true,
  'a page with older comments left reports that more exist'
);
select is(
  (select count(*)::integer from page_one where total_count is not null),
  1,
  'the page-level values ride on ONE row, so they cannot grow with the page'
);
select is(
  (select count(*)::integer from page_one where next_before is not null and next_before_id is not null),
  1,
  'the cursor rides on one row too'
);
select is(
  (select body from page_one order by created_at asc limit 1),
  'root 58',
  'the page is the newest roots, returned oldest first for display'
);
select is(
  (select next_before_id from page_one where next_before_id is not null),
  (select id from fixture_roots where position = 58),
  'the cursor is the OLDEST root on the page'
);

-- ─── The page above it ──────────────────────────────────────────────────────

create temporary table page_two as
select * from public.get_thread_comment_page(
  (select id from fixture_thread),
  50,
  (select next_before from page_one where next_before is not null),
  (select next_before_id from page_one where next_before_id is not null)
);

select is(
  (select count(*)::integer from page_two),
  50,
  'the next page holds the next 50 roots, and no replies yet'
);
select is(
  (select count(*)::integer from page_two where parent_id is null),
  50,
  'that page holds only the roots above the cursor'
);
select is(
  (select count(*)::integer from page_two where body = 'root 58'),
  0,
  'the cursor excludes the page it came from'
);
select is(
  (select distinct has_more from page_two where has_more is not null),
  true,
  'it still reports that older comments exist'
);

create temporary table page_three as
select * from public.get_thread_comment_page(
  (select id from fixture_thread),
  50,
  (select next_before from page_two where next_before is not null),
  (select next_before_id from page_two where next_before_id is not null)
);

select is(
  (select count(*)::integer from page_three),
  10,
  'the last page is the 7 roots left plus the 3 replies under the oldest'
);
select is(
  (select count(*)::integer from page_three where parent_id is not null),
  3,
  'the oldest root''s replies travel with their root'
);
select is(
  (select distinct has_more from page_three where has_more is not null),
  false,
  'the last page reports that nothing follows'
);
select is(
  (select count(*)::integer from page_three where next_before is not null),
  0,
  'and carries no cursor, so a caller cannot ask past the end'
);
select is(
  (select count(distinct id)::integer from (
    select id from page_one union all select id from page_two union all select id from page_three
  ) as paged),
  63,
  'the three pages together cover every comment exactly once'
);
select is(
  (select count(*)::integer from public.thread_comments where thread_id = (select id from fixture_thread)),
  (select count(*)::integer from (
    select id from page_one union all select id from page_two union all select id from page_three
  ) as paged),
  'and that union is the whole table for the thread'
);

-- ─── The bound is the page, not the caller's limit ──────────────────────────

select is(
  (select count(*)::integer
   from public.get_thread_comment_page((select id from fixture_thread), 5000)
   where parent_id is null),
  50,
  'an oversized limit is clamped to 50 roots rather than returning the whole list'
);

-- ─── One read per kind ──────────────────────────────────────────────────────

create temporary table fixture_resource as
with inserted as (
  insert into public.community_resources (community_id, user_id, title, resource_type, url)
  values (
    (select community_id from fixture_viewer),
    (select user_id from fixture_viewer),
    'comment page fixture resource',
    'article',
    'https://example.test/fixture'
  )
  returning id
) select id from inserted;

insert into public.resource_comments (resource_id, user_id, body, created_at)
select
  (select id from fixture_resource),
  (select user_id from fixture_viewer),
  'resource root ' || series.value,
  timestamp with time zone '2026-01-01 00:00:00+00' + series.value * interval '1 second'
from generate_series(1, 2) as series(value);

-- The reply hangs off the OLDEST root, so it is only reached by the page that
-- reaches that root — which is not the newest one.
insert into public.resource_comments (resource_id, user_id, parent_id, body, created_at)
values (
  (select id from fixture_resource),
  (select user_id from fixture_reply_author),
  (select id from public.resource_comments where body = 'resource root 1'),
  'resource reply',
  timestamp with time zone '2026-01-01 00:03:00+00'
);

create temporary table resource_page as
select * from public.get_resource_comment_page((select id from fixture_resource), 2);

select is(
  (select distinct total_count::integer from resource_page where total_count is not null),
  3,
  'a resource page counts its own comments — roots and replies'
);
select is(
  (select count(*)::integer from resource_page),
  3,
  'the page carries the reply that hangs off one of its roots'
);
select is(
  (select count(*)::integer from resource_page where parent_id is not null),
  1,
  'and nothing else'
);
select is(
  (select count(*)::integer
   from public.get_resource_comment_page('00000000-0000-0000-0000-000000000000'::uuid, 20)),
  0,
  'an item with no comments pages to nothing, not to the whole table'
);
select is(
  (select count(*)::integer
   from public.get_showcase_comment_page('00000000-0000-0000-0000-000000000000'::uuid, 20)),
  0,
  'and neither does a missing showcase post'
);

create temporary table fixture_showcase as
with inserted as (
  insert into public.community_showcase_posts (community_id, user_id, title, image_url, category)
  values (
    (select community_id from fixture_viewer),
    (select user_id from fixture_viewer),
    'comment page fixture post',
    'https://example.test/post.png',
    'ui_design'
  )
  returning id
) select id from inserted;

insert into public.showcase_comments (post_id, user_id, body, created_at)
select
  (select id from fixture_showcase),
  (select user_id from fixture_viewer),
  'showcase root ' || series.value,
  timestamp with time zone '2026-01-01 00:00:00+00' + series.value * interval '1 second'
from generate_series(1, 2) as series(value);

select is(
  (select count(*)::integer
   from public.get_showcase_comment_page((select id from fixture_showcase), 20)),
  2,
  'a showcase page returns its own comments'
);

create temporary table fixture_event as
with inserted as (
  insert into public.community_events (community_id, user_id, title, event_date)
  values (
    (select community_id from fixture_viewer),
    (select user_id from fixture_viewer),
    'comment page fixture event',
    now() + interval '1 day'
  )
  returning id
) select id from inserted;

insert into public.event_comments (event_id, user_id, body, created_at)
select
  (select id from fixture_event),
  (select user_id from fixture_viewer),
  'event root ' || series.value,
  timestamp with time zone '2026-01-01 00:00:00+00' + series.value * interval '1 second'
from generate_series(1, 2) as series(value);

insert into public.event_comments (event_id, user_id, parent_id, body, image_url, created_at)
values (
  (select id from fixture_event),
  (select user_id from fixture_reply_author),
  (select id from public.event_comments where body = 'event root 1'),
  'event reply with image',
  'https://example.test/comment.png',
  timestamp with time zone '2026-01-01 00:03:00+00'
);

create temporary table event_page as
select * from public.get_event_comment_page((select id from fixture_event), 20);

select is(
  (select count(*)::integer from event_page),
  3,
  'an event page returns its roots and the replies under them'
);
select is(
  (select image_url from event_page where body = 'event reply with image'),
  'https://example.test/comment.png',
  'the event page keeps the image a comment can carry'
);
select is(
  (select distinct has_more from event_page where has_more is not null),
  false,
  'and reports that the list is complete'
);

select * from public.finish();
rollback;
