-- ============================================================================
-- get_community_message_page: the page-level columns pay per AUTHOR and per
-- CONTENT ITEM — never per message.
--
-- Two page-level values ride on a single row of the page:
--   * `content_reactions` — the card reactions of the page's content items
--     (20260928170000_message_page_content_reactions_once);
--   * `authors` — the name, avatar and designation of every distinct author the
--     page shows (20261015170000_message_page_author_map).
--
-- Both were once per-row values (the author blob literally so: 1,839 B on a
-- 13-row page, 26% of it). The failure mode this file guards is not "the column
-- disappeared" — the suites for each value cover their content — but "it started
-- costing by the ROW again", which is invisible to a single-page assertion: the
-- same query with a longer limit must NOT produce a longer payload.
--
-- Fixtures are inserted inside a transaction and rolled back.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- ─── Fixtures: many messages, few authors ───────────────────────────────────

create temporary table fixture_viewer as
select community_id, user_id, joined_at
from public.community_members
order by joined_at
limit 1;

create temporary table fixture_other_author as
select id as user_id
from public.users
where id <> (select user_id from fixture_viewer)
order by id
limit 1;

select ok(
  (select user_id from fixture_other_author) is not null,
  'the seeded database has a second author for the page fixture'
);

-- 40 messages alternating between two authors: a per-message author payload
-- would be 40 copies, a per-author one is 2 entries at any limit.
insert into public.community_messages (community_id, user_id, content, created_at)
select
  (select community_id from fixture_viewer),
  case when series.value % 2 = 0
       then (select user_id from fixture_viewer)
       else (select user_id from fixture_other_author)
  end,
  'page-level payload fixture ' || series.value,
  (select joined_at from fixture_viewer) + series.value * interval '1 millisecond'
from generate_series(1, 40) as series(value);

-- One content item with reactions, so content_reactions has something to carry.
create temporary table fixture_thread as
with inserted as (
  insert into public.community_threads (community_id, user_id, title, category)
  values (
    (select community_id from fixture_viewer),
    (select user_id from fixture_viewer),
    'page-level payload fixture thread',
    'discussion'
  )
  returning id
)
select id from inserted;

insert into public.content_reactions (content_id, content_kind, community_id, user_id, emoji)
values (
  (select id from fixture_thread), 'thread', (select community_id from fixture_viewer),
  (select user_id from fixture_viewer), '🔥'
);

-- ─── Two pages of the same room: 20 messages, then 40 ───────────────────────

create temporary table page_small as
select *
from public.get_community_message_page(
  (select community_id from fixture_viewer),
  (select user_id from fixture_viewer),
  (select joined_at from fixture_viewer),
  null, null, 20,
  array[(select id from fixture_thread)]
);

create temporary table page_large as
select *
from public.get_community_message_page(
  (select community_id from fixture_viewer),
  (select user_id from fixture_viewer),
  (select joined_at from fixture_viewer),
  null, null, 40,
  array[(select id from fixture_thread)]
);

select is(
  (select count(*)::integer from page_small),
  20,
  'the small page holds the smaller number of messages'
);

select is(
  (select count(*)::integer from page_large),
  40,
  'the large page holds the larger number of messages'
);

select is(
  (select count(*)::integer from page_large where authors is not null),
  1,
  'the author map is attached to exactly one row of the larger page'
);

-- ─── The guard: more messages, same author payload ──────────────────────────

select is(
  (select max(pg_column_size(authors)) from page_large),
  (select max(pg_column_size(authors)) from page_small),
  'doubling the messages does not grow the author payload'
);

select is(
  (select max(pg_column_size(content_reactions)) from page_large),
  (select max(pg_column_size(content_reactions)) from page_small),
  'doubling the messages does not grow the content-reaction payload'
);

select ok(
  (select sum(pg_column_size(authors)) from page_large)
    <= (select max(pg_column_size(authors)) from page_large),
  'the larger page transfers ONE copy of the author map, not one per message'
);

select ok(
  (select sum(pg_column_size(content_reactions)) from page_large)
    <= (select max(pg_column_size(content_reactions)) from page_large),
  'the larger page transfers ONE copy of the content-reaction groups'
);

-- And the payload tracks the fixture's two authors rather than its 40 rows.
select is(
  (select count(*)::integer
   from page_large, jsonb_object_keys(page_large.authors)
   where page_large.authors is not null),
  2,
  'the author map has one entry per distinct author, not one per message'
);

select * from public.finish();
rollback;
