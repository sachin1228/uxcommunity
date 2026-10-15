-- ============================================================================
-- get_comment_reaction_summaries: a crowd costs one row, not one per person
--
-- Comment reactions used to be read as raw `(comment_id, user_id, emoji)` rows
-- and counted in the app, so drawing five pills transferred the thread's whole
-- popularity (docs/supabase-egress-audit.md §4 #7). The aggregate answers per
-- (comment, emoji) instead — the count and the CALLER's own state, which is all
-- a comment pill renders.
--
-- These assertions pin the three properties that make the replacement safe:
--   * the group's size is the whole crowd, not just the caller;
--   * `reacted` is the caller's membership of that group and nobody else's;
--   * the row count per (comment, emoji) is ONE however many people react —
--     the bound the old read did not have.
-- Plus the kind routing (a kind's tables are separate) and the empty cases.
--
-- Fixtures are inserted inside a transaction and rolled back.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- ─── Contract ───────────────────────────────────────────────────────────────

select has_function(
  'public', 'get_comment_reaction_summaries', array['uuid', 'text', 'uuid[]']
);

-- ─── Fixtures ───────────────────────────────────────────────────────────────

-- The caller — the member whose own reactions the payload must highlight.
create temporary table fixture_viewer as
select community_id, user_id
from public.community_members
order by joined_at
limit 1;

-- Two other members, so a group has a crowd the caller is only part of.
create temporary table fixture_others as
select id as user_id
from public.users
where id <> (select user_id from fixture_viewer)
order by id
limit 2;

select ok(
  (select count(*) from fixture_others) = 2,
  'the seeded database has two other users for the crowd fixture'
);

create temporary table fixture_thread as
with inserted as (
  insert into public.community_threads (community_id, user_id, title, category)
  values (
    (select community_id from fixture_viewer),
    (select user_id from fixture_viewer),
    'reaction summary fixture thread',
    'discussion'
  )
  returning id
)
select id from inserted;

create temporary table fixture_comments as
with inserted as (
  insert into public.thread_comments (thread_id, user_id, body)
  select (select id from fixture_thread), (select user_id from fixture_viewer), 'fixture comment ' || series.value
  from generate_series(1, 2) as series(value)
  returning id, body
)
select id, row_number() over (order by body) as position from inserted;

-- Three reactors on 👍: the caller and both others.
insert into public.thread_comment_reactions (comment_id, user_id, emoji)
select (select id from fixture_comments where position = 1), reactor.user_id, '👍'
from (
  select user_id from fixture_viewer
  union all
  select user_id from fixture_others
) as reactor;

-- Two reactors on 🎉: the others only, so `reacted` must stay false for a group
-- the caller is not in — and the count must still be the crowd's.
insert into public.thread_comment_reactions (comment_id, user_id, emoji)
select (select id from fixture_comments where position = 1), reactor.user_id, '🎉'
from fixture_others as reactor;

-- The second comment: one other reactor, no reaction from the caller.
insert into public.thread_comment_reactions (comment_id, user_id, emoji)
select (select id from fixture_comments where position = 2),
       (select user_id from fixture_others order by user_id limit 1),
       '💡';

create temporary view fixture_summary as
select *
from public.get_comment_reaction_summaries(
  (select user_id from fixture_viewer),
  'threads',
  (select array_agg(id) from fixture_comments)
);

-- ─── The group is the crowd, and only one row carries it ────────────────────

select is(
  (select count(*)::integer from fixture_summary
   where comment_id = (select id from fixture_comments where position = 1)
     and emoji = '👍'),
  1,
  'a group of three people is one row'
);

select is(
  (select reaction_count::integer from fixture_summary
   where comment_id = (select id from fixture_comments where position = 1)
     and emoji = '👍'),
  3,
  'the group''s size is the whole crowd, not just the caller'
);

select is(
  (select reacted from fixture_summary
   where comment_id = (select id from fixture_comments where position = 1)
     and emoji = '👍'),
  true,
  'the caller is reported as part of a group they are in'
);

select is(
  (select reacted from fixture_summary
   where comment_id = (select id from fixture_comments where position = 1)
     and emoji = '🎉'),
  false,
  'a group the caller is not in is not highlighted'
);

select is(
  (select reaction_count::integer from fixture_summary
   where comment_id = (select id from fixture_comments where position = 1)
     and emoji = '🎉'),
  2,
  'a group the caller is not in still counts its own reactors'
);

-- ─── The bound: popularity does not change the payload's shape ───────────────

-- Everyone else in the database onto the same emoji. The old read transferred
-- every one of them; the aggregate must still answer with the one row it
-- already returned.
insert into public.thread_comment_reactions (comment_id, user_id, emoji)
select (select id from fixture_comments where position = 1), user_row.id, '🎉'
from public.users as user_row
where user_row.id not in (
  select user_id from fixture_viewer union all select user_id from fixture_others
)
limit 40;

select is(
  (select count(*)::integer
   from public.get_comment_reaction_summaries(
     (select user_id from fixture_viewer),
     'threads',
     array[(select id from fixture_comments where position = 1)]
   )
   where emoji = '🎉'),
  1,
  'one emoji is one row however many people react to it'
);

select is(
  (select reaction_count
   from public.get_comment_reaction_summaries(
     (select user_id from fixture_viewer),
     'threads',
     array[(select id from fixture_comments where position = 1)]
   )
   where emoji = '🎉'),
  (select count(*)::bigint from public.thread_comment_reactions
   where comment_id = (select id from fixture_comments where position = 1) and emoji = '🎉'),
  'and that row still reports the whole crowd'
);

-- ─── Per-comment grouping ───────────────────────────────────────────────────

select is(
  (select reaction_count::integer from fixture_summary
   where comment_id = (select id from fixture_comments where position = 2)
     and emoji = '💡'),
  1,
  'a second comment''s reactions are its own'
);

select is(
  (select count(*)::integer from fixture_summary
   where comment_id = (select id from fixture_comments where position = 2)),
  1,
  'neither comment''s rows leak into the other'
);

-- ─── Routing and empty cases ────────────────────────────────────────────────

select is(
  (select count(*)::integer
   from public.get_comment_reaction_summaries(
     (select user_id from fixture_viewer),
     'resources',
     (select array_agg(id) from fixture_comments)
   )),
  0,
  'a kind reads its own table: thread reactions are not resource reactions'
);

select is(
  (select count(*)::integer
   from public.get_comment_reaction_summaries(
     (select user_id from fixture_viewer),
     'not-a-kind',
     (select array_agg(id) from fixture_comments)
   )),
  0,
  'an unknown kind returns nothing rather than guessing a table'
);

select is(
  (select count(*)::integer
   from public.get_comment_reaction_summaries(
     (select user_id from fixture_viewer),
     'threads',
     '{}'::uuid[]
   )),
  0,
  'an empty page of comments asks for nothing and gets nothing'
);

select * from public.finish();
rollback;
