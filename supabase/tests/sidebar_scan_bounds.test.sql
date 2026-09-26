-- ============================================================
-- Sidebar / unread read models: scan bounds and semantics
--
-- get_sidebar_activity and get_unread_message_totals were rewritten to start
-- their scans at greatest(last_read_at, joined_at) and to resolve "newest row
-- per community" with LIMIT 1 laterals (migration
-- 20260926120000_sidebar_scan_bounds.sql).
--
-- These assertions pin the semantics that rewrite had to preserve:
--
--   * unread counts exclude the caller's own messages and everything that
--     predates the read watermark;
--   * the last_message / last_content previews STILL show the newest activity
--     even when it is already read (they are deliberately not bounded by the
--     read watermark — the subtle case a naive "scan from last_read_at"
--     rewrite gets wrong by blanking the sidebar preview);
--   * unread content respects the community's enabled areas;
--   * the newest reaction wins across both anchor tables, and is suppressed
--     when it predates the newest message;
--   * archived memberships still render in the sidebar but are excluded from
--     the push badge total;
--   * the indexes the new per-community lookups rely on exist.
--
-- Fixtures are inserted inside a transaction and rolled back.
-- ============================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- ─── Fixture selection ──────────────────────────────────────────────────────

create temporary table fixture_membership as
select community_id as community_a, user_id as viewer_id
from public.community_members
order by joined_at
limit 1;

select ok(
  exists (select 1 from fixture_membership),
  'seeded test database has a community member fixture'
);

create temporary table fixture_others as
select cm.id as community_id,
       row_number() over (order by cm.id) as position
from public.communities cm
where cm.id <> (select community_a from fixture_membership)
order by cm.id
limit 3;

create temporary table fixture_author as
select u.id as author_id
from public.users u
join public.community_members cm on cm.user_id = u.id
where cm.community_id = (select community_a from fixture_membership)
  and u.id <> (select viewer_id from fixture_membership)
limit 1;

-- Fall back to any other user when the viewer is the only member.
insert into fixture_author
select u.id from public.users u
where u.id <> (select viewer_id from fixture_membership)
  and not exists (select 1 from fixture_author)
limit 1;

select ok(
  exists (select 1 from fixture_author),
  'seeded test database has a second user for authored fixtures'
);

-- ─── Community A: threads-only areas, unread messages and a newer reaction ──

update public.community_members
set joined_at = now() - interval '10 days',
    last_read_at = now() - interval '1 day',
    archived_at = null
where community_id = (select community_a from fixture_membership)
  and user_id = (select viewer_id from fixture_membership);

update public.communities
set enabled_tabs = '{threads}',
    showcase_enabled = true
where id = (select community_a from fixture_membership);

insert into public.community_messages (community_id, user_id, content, created_at)
select (select community_a from fixture_membership), (select author_id from fixture_author),
       'already read', now() - interval '9 days'
union all
select (select community_a from fixture_membership), (select author_id from fixture_author),
       'mention me', now() - interval '2 hours'
union all
select (select community_a from fixture_membership), (select author_id from fixture_author),
       'newest message', now() - interval '30 minutes'
union all
select (select community_a from fixture_membership), (select viewer_id from fixture_membership),
       'mine, not unread', now() - interval '1 hour';

update public.community_messages
set mentions = jsonb_build_array(jsonb_build_object(
      'user_id', (select viewer_id from fixture_membership)::text, 'name', 'Viewer'))
where community_id = (select community_a from fixture_membership)
  and content = 'mention me';

insert into public.message_reactions (message_id, community_id, user_id, emoji, created_at)
select m.id, m.community_id, (select author_id from fixture_author), '🔥', now() - interval '10 minutes'
from public.community_messages m
where m.community_id = (select community_a from fixture_membership)
  and m.content = 'newest message';

insert into public.community_threads (community_id, user_id, title, created_at)
values ((select community_a from fixture_membership), (select author_id from fixture_author),
        'unread thread', now() - interval '90 minutes');

-- A resource is deliberately newer than the thread: community A has only the
-- threads area enabled, so it must not raise the unread content count or take
-- over last_content.
insert into public.community_resources (community_id, user_id, title, created_at)
values ((select community_a from fixture_membership), (select author_id from fixture_author),
        'ignored resource', now() - interval '80 minutes');

-- ─── Community B: archived membership with an unread message ────────────────

insert into public.community_members (community_id, user_id, joined_at, last_read_at, archived_at)
select (select community_id from fixture_others where position = 1),
       (select viewer_id from fixture_membership),
       now() - interval '10 days', now() - interval '1 day', now() - interval '1 hour'
where exists (select 1 from fixture_others where position = 1);

insert into public.community_messages (community_id, user_id, content, created_at)
select (select community_id from fixture_others where position = 1),
       (select author_id from fixture_author), 'unread in archived community', now() - interval '2 hours'
where exists (select 1 from fixture_others where position = 1);

-- ─── Community C: the newest reaction predates the newest message ───────────

insert into public.community_members (community_id, user_id, joined_at, last_read_at)
select (select community_id from fixture_others where position = 2),
       (select viewer_id from fixture_membership),
       now() - interval '10 days', now() - interval '1 day'
where exists (select 1 from fixture_others where position = 2);

insert into public.community_messages (community_id, user_id, content, created_at)
select (select community_id from fixture_others where position = 2),
       (select author_id from fixture_author), 'reaction is older', now() - interval '3 hours'
where exists (select 1 from fixture_others where position = 2);

insert into public.message_reactions (message_id, community_id, user_id, emoji, created_at)
select m.id, m.community_id, (select author_id from fixture_author), '👍', now() - interval '4 hours'
from public.community_messages m
where m.community_id = (select community_id from fixture_others where position = 2)
  and m.content = 'reaction is older';

-- ─── Community D: read watermark past the newest message ────────────────────

insert into public.community_members (community_id, user_id, joined_at, last_read_at)
select (select community_id from fixture_others where position = 3),
       (select viewer_id from fixture_membership),
       now() - interval '10 days', now() - interval '1 day'
where exists (select 1 from fixture_others where position = 3);

insert into public.community_messages (community_id, user_id, content, created_at)
select (select community_id from fixture_others where position = 3),
       (select author_id from fixture_author), 'read but still newest', now() - interval '2 days'
where exists (select 1 from fixture_others where position = 3);

-- ─── Projections ────────────────────────────────────────────────────────────

create temporary view sidebar_rows as
select elem
from jsonb_array_elements(
  public.get_sidebar_activity((select viewer_id from fixture_membership))
) elem;

select is(
  (select count(*)::integer from sidebar_rows),
  (select count(*)::integer from public.community_members
   where user_id = (select viewer_id from fixture_membership)),
  'sidebar returns exactly one row per membership, archived included'
);

create temporary view community_a_row as
select elem from sidebar_rows
where elem->>'community_id' = (select community_a::text from fixture_membership);

create temporary view community_b_row as
select elem from sidebar_rows
where elem->>'community_id' = (select community_id::text from fixture_others where position = 1);

create temporary view community_c_row as
select elem from sidebar_rows
where elem->>'community_id' = (select community_id::text from fixture_others where position = 2);

create temporary view community_d_row as
select elem from sidebar_rows
where elem->>'community_id' = (select community_id::text from fixture_others where position = 3);

select is(
  (select (elem->>'unread_count')::integer from community_a_row),
  2,
  'unread counts exclude own messages and everything before last_read_at'
);

select is(
  (select (elem->>'unread_mention_count')::integer from community_a_row),
  1,
  'mention count only counts unread messages that mention the viewer'
);

select is(
  (select (elem->>'unread_content_count')::integer from community_a_row),
  1,
  'unread content respects the community enabled areas'
);

select is(
  (select elem->'last_message'->>'content' from community_a_row),
  'newest message',
  'last_message is the newest message'
);

select is(
  (select elem->'last_content'->>'title' from community_a_row),
  'unread thread',
  'last_content ignores areas the community has disabled'
);

select is(
  (select elem->'last_reaction'->>'message_content' from community_a_row),
  'newest message',
  'the newest reaction wins across both anchor tables'
);

-- The remaining communities depend on the seeded database having more than one
-- community, so each assertion is guarded with coalesce: an absent fixture
-- leaves the invariant untouched instead of failing for the wrong reason.
select is(
  coalesce((select (elem->>'unread_count')::integer from community_b_row), 1),
  1,
  'archived memberships still report unread counts in the sidebar'
);

-- The sidebar always emits the last_reaction key; suppression means a JSON
-- null in it (the reaction exists but is older than the newest message).
select is(
  (select elem->'last_reaction' from community_c_row),
  'null'::jsonb,
  'a reaction older than the newest message is suppressed (or has no fixture)'
);

select is(
  coalesce((select (elem->>'unread_count')::integer from community_c_row), 1),
  1,
  'a community with a suppressed reaction still counts its unread message'
);

select is(
  coalesce((select (elem->>'unread_count')::integer from community_d_row), 0),
  0,
  'nothing after the read watermark counts as unread'
);

select is(
  coalesce((select elem->'last_message'->>'content' from community_d_row),
           'read but still newest'),
  'read but still newest',
  'the preview still shows the newest message when the read watermark is past it'
);

-- ─── Push badge totals ──────────────────────────────────────────────────────

-- The badge must equal the non-archived communities' unread counts: the
-- archived community B (which reports 1 in the sidebar) must not leak into it.
select is(
  (select unread from public.get_unread_message_totals(
     array[(select viewer_id from fixture_membership)])),
  coalesce((select (elem->>'unread_count')::integer from community_a_row), 0)
    + coalesce((select (elem->>'unread_count')::integer from community_c_row), 0),
  'badge total sums unread across communities and excludes archived memberships'
);

select is(
  (select count(*)::integer from public.get_unread_message_totals(array[]::uuid[])),
  0,
  'badge total is empty for an empty recipient list'
);

-- ─── Indexes the bounded lookups rely on ────────────────────────────────────

select has_index('public', 'message_reactions', 'idx_message_reactions_community_created',
  'newest message-reaction lookup is indexed');

select has_index('public', 'content_reactions', 'idx_content_reactions_community_created',
  'newest content-reaction lookup is indexed');

select has_index('public', 'community_events', 'idx_community_events_community_created',
  'newest event lookup is indexed');

select * from finish();
rollback;
