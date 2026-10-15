-- ============================================================================
-- get_community_message_page: the page's authors ride once, per AUTHOR
--
-- The page used to carry `users` on every row — name, avatar and designation
-- rebuilt from three joins per message, measured at 26% of the page
-- (docs/supabase-egress-audit.md §4 #4). 20261015170000 replaces it with ONE
-- `authors` map on a single row: `{ user_id: { name, avatar_url, designation } }`
-- for the page's distinct authors.
--
-- Two things are being pinned here, and the second is the reason the blob was
-- NOT simply deleted:
--
--   * the payload is per author, not per message — one row carries the map, and
--     the map has one entry per distinct author however many messages the page
--     holds;
--   * an author is resolved even when they are no longer a community member.
--     The audit's recommendation assumed the client could resolve authors from
--     "the members it already has"; the chat's member list is the ten most recent
--     members, and a room's history is written by everyone. A message from a
--     former member must still show their name.
--
-- Fixtures are inserted inside a transaction and rolled back.
-- ============================================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- ─── The column is gone, the map is there ───────────────────────────────────

-- The returns-table column list, read off the function itself (a
-- set-returning function is not in information_schema.columns).
select is(
  (select 'users' = any(p.proargnames)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_community_message_page'),
  false,
  'the per-row users blob is no longer part of the page''s shape'
);

select is(
  (select 'authors' = any(p.proargnames)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'get_community_message_page'),
  true,
  'the page carries an authors column instead'
);

-- ─── Fixtures ───────────────────────────────────────────────────────────────

create temporary table fixture_viewer as
select community_id, user_id, joined_at
from public.community_members
order by joined_at
limit 1;

-- A CURRENT member other than the viewer, and a DEPARTED author: a user with no
-- membership row in this community at all. Both write messages.
create temporary table fixture_authors as
select
  (select u.id from public.users u
    where u.id <> (select user_id from fixture_viewer)
      and not exists (
        select 1 from public.community_members cm
        where cm.community_id = (select community_id from fixture_viewer) and cm.user_id = u.id
      )
    order by u.id limit 1) as departed_author_id,
  (select user_id from fixture_viewer) as member_author_id;

select ok(
  (select departed_author_id from fixture_authors) is not null,
  'the seeded database has a user who is not a member of the fixture community'
);

insert into public.community_messages (community_id, user_id, content, created_at)
select
  (select community_id from fixture_viewer),
  case when series.value % 2 = 0
       then (select member_author_id from fixture_authors)
       else (select departed_author_id from fixture_authors)
  end,
  'author map fixture ' || series.value,
  (select joined_at from fixture_viewer) + series.value * interval '1 millisecond'
from generate_series(1, 30) as series(value);

create temporary table fixture_page as
select *
from public.get_community_message_page(
  (select community_id from fixture_viewer),
  (select user_id from fixture_viewer),
  (select joined_at from fixture_viewer),
  null, null, 50, null
);

-- ─── One copy, per author ───────────────────────────────────────────────────

select is(
  (select count(*)::integer from fixture_page),
  30,
  'the page still returns its messages'
);

select is(
  (select count(authors)::integer from fixture_page),
  1,
  'the author map is attached to exactly one row of the page'
);

select is(
  (select count(*)::integer from fixture_page where authors is null),
  29,
  'every other row carries NULL instead of a repeated copy'
);

select is(
  (select count(*)::integer
   from fixture_page, jsonb_object_keys(fixture_page.authors)
   where fixture_page.authors is not null),
  2,
  'the map holds one entry per distinct author, not one per message'
);

-- ─── The names themselves ───────────────────────────────────────────────────

select is(
  (select authors -> (select member_author_id::text from fixture_authors) ->> 'name'
   from fixture_page where authors is not null),
  (select u.name from public.users u where u.id = (select member_author_id from fixture_authors)),
  'a current member''s name is resolved'
);

-- The regression guard: this author has no community_members row, so a client
-- resolving names from its member list could not name them at all.
select is(
  (select authors -> (select departed_author_id::text from fixture_authors) ->> 'name'
   from fixture_page where authors is not null),
  (select u.name from public.users u where u.id = (select departed_author_id from fixture_authors)),
  'an author who has left the community still has a name'
);

select * from public.finish();
rollback;
