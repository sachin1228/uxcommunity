-- ============================================================
-- get_community_message_page: content_reactions rides once per page (M-3 / D6)
--
-- The RPC attaches the page's content-reaction groups with an UNCORRELATED
-- `left join lateral … on true`. The aggregate is therefore evaluated once,
-- but PostgreSQL used to stamp the same JSON onto EVERY row of the page: a
-- 50-message page transferred the identical card-reaction payload 50 times,
-- and `loadCommunityMessagePage` only hoisted/dropped the copies AFTER the
-- bytes had crossed the wire.
--
-- 20260928170000_message_page_content_reactions_once.sql hangs the aggregate on
-- a single row (the first of the query's own `order by created_at desc, id
-- desc`) and leaves the rest NULL. These assertions pin the contract:
--
--   * the page still returns all of its message rows, unchanged;
--   * exactly one row carries content_reactions, and it carries the same
--     grouped value the old shape repeated (both reactors, their emoji and
--     user ids), so the route's hoist is unchanged;
--   * the total bytes of the content_reactions column across the page equal ONE
--     copy rather than one per message — the guard against reintroducing the
--     per-row duplication;
--   * a page whose interesting content has no reactions still reports the key
--     as an empty list, still on a single row.
--
-- Fixtures are inserted inside a transaction and rolled back.
-- ============================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- ─── Fixtures ───────────────────────────────────────────────────────────────

create temporary table fixture_membership as
select community_id, user_id, clock_timestamp() as history_start
from public.community_members
order by joined_at
limit 1;

select ok(
  exists (select 1 from fixture_membership),
  'seeded test database has a community member fixture'
);

-- A second, distinct user so the content item can carry two reaction types
-- (content_reactions allows one reaction per user per item).
create temporary table fixture_author as
select u.id as author_id
from public.users u
where u.id <> (select user_id from fixture_membership)
order by u.id
limit 1;

select ok(
  exists (select 1 from fixture_author),
  'seeded test database has a second user for the reaction fixture'
);

-- The content item whose reactions the page must carry exactly once.
create temporary table fixture_thread as
with inserted as (
  insert into public.community_threads (community_id, user_id, title, category, created_at)
  values (
    (select community_id from fixture_membership),
    (select author_id from fixture_author),
    'm3 content-reaction fixture thread',
    'discussion',
    (select history_start from fixture_membership)
  )
  returning id
)
select id from inserted;

insert into public.content_reactions (content_id, content_kind, community_id, user_id, emoji, created_at)
select (select id from fixture_thread), 'thread', (select community_id from fixture_membership),
       (select user_id from fixture_membership), '🔥', (select history_start from fixture_membership);

insert into public.content_reactions (content_id, content_kind, community_id, user_id, emoji, created_at)
select (select id from fixture_thread), 'thread', (select community_id from fixture_membership),
       (select author_id from fixture_author), '👍', (select history_start from fixture_membership)
where exists (select 1 from fixture_author);

-- 30 messages, all newer than anything already in the community, so the page
-- under test is exactly these rows and per-row duplication would be visible.
insert into public.community_messages (community_id, user_id, content, created_at)
select (select community_id from fixture_membership),
       (select author_id from fixture_author),
       'm3 page fixture ' || series.value,
       (select history_start from fixture_membership) + series.value * interval '1 millisecond'
from generate_series(1, 30) as series(value);

create temporary table fixture_page as
select *
from public.get_community_message_page(
  (select community_id from fixture_membership),
  (select user_id from fixture_membership),
  (select history_start from fixture_membership),
  null, null, 30,
  array[(select id from fixture_thread)]
);

create temporary table fixture_page_stats as
select
  count(*)::integer as page_rows,
  count(content_reactions)::integer as carrying_rows,
  coalesce(sum(pg_column_size(content_reactions)), 0)::integer as column_bytes,
  coalesce(max(case when content_reactions is not null then pg_column_size(content_reactions) end), 0)::integer as one_copy_bytes
from fixture_page;

-- ─── The page still carries every message ───────────────────────────────────

select ok(
  (select page_rows from fixture_page_stats) >= 2,
  'the message page returns the fixture rows (more than one, so duplication would be observable)'
);

select is(
  (select count(distinct content)::integer from fixture_page where content like 'm3 page fixture %'),
  30,
  'every fixture message is still on the page'
);

-- ─── The single copy ────────────────────────────────────────────────────────

select is(
  (select carrying_rows from fixture_page_stats),
  1,
  'content_reactions is attached to exactly one row of the page'
);

select is(
  (select count(*)::integer from fixture_page where content_reactions is null),
  (select page_rows - 1 from fixture_page_stats),
  'every other row carries NULL instead of a repeated copy'
);

select is(
  (select jsonb_typeof(content_reactions) from fixture_page where content_reactions is not null limit 1),
  'array',
  'the single copy is a jsonb array'
);

select is(
  (select jsonb_array_length(content_reactions) from fixture_page where content_reactions is not null limit 1),
  1,
  'the single copy carries one content item'
);

select is(
  (select content_reactions -> 0 ->> 'content_id' from fixture_page where content_reactions is not null limit 1),
  (select id::text from fixture_thread),
  'the carried group is the fixture content item'
);

select is(
  (select content_reactions -> 0 ->> 'kind' from fixture_page where content_reactions is not null limit 1),
  'thread',
  'the carried group keeps its content kind'
);

select ok(
  (select content_reactions @> jsonb_build_array(
      jsonb_build_object(
        'content_id', (select id::text from fixture_thread),
        'reactions', jsonb_build_array(
          jsonb_build_object('emoji', '🔥', 'user_ids', jsonb_build_array((select user_id::text from fixture_membership)))
        )
      )
    )
   from fixture_page where content_reactions is not null limit 1),
  'the single copy keeps the viewer''s emoji and user id'
);

select ok(
  (select content_reactions @> jsonb_build_array(
      jsonb_build_object(
        'content_id', (select id::text from fixture_thread),
        'reactions', jsonb_build_array(
          jsonb_build_object('emoji', '👍', 'user_ids', jsonb_build_array((select author_id::text from fixture_author)))
        )
      )
    )
   from fixture_page where content_reactions is not null limit 1),
  'the single copy keeps the second reactor''s emoji and user id'
);

-- ─── Query/payload reduction guard ──────────────────────────────────────────

select ok(
  (select one_copy_bytes from fixture_page_stats) > 0,
  'the fixture produces a non-empty copy, so the duplication guard is meaningful'
);

select ok(
  (select column_bytes from fixture_page_stats) <= (select one_copy_bytes from fixture_page_stats),
  'the page transfers a single copy of content_reactions'
);

select ok(
  (select column_bytes from fixture_page_stats) < (select page_rows * one_copy_bytes from fixture_page_stats),
  'the page does not repeat the copy once per message'
);

-- ─── A reaction-free page still reports the key ─────────────────────────────

create temporary table fixture_empty_page as
select *
from public.get_community_message_page(
  (select community_id from fixture_membership),
  (select user_id from fixture_membership),
  (select history_start from fixture_membership),
  null, null, 30,
  '{}'::uuid[]
);

select is(
  (select count(*)::integer from fixture_empty_page where content_reactions is not null),
  1,
  'a reaction-free page still attaches the list to exactly one row'
);

select is(
  (select content_reactions from fixture_empty_page where content_reactions is not null),
  '[]'::jsonb,
  'a reaction-free page reports an empty list'
);

select * from finish();
rollback;
