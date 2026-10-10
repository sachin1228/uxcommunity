-- get_profile_feed_page: the Saved scopes list what the member actually saved.
--
-- Saving a RESOURCE is the card menu's Bookmark ("Save"/"Unsave",
-- resource_bookmarks) — resource_saves is the card's heart ("Like"/"Unlike").
-- The saved scopes must list the bookmark and never a heart, while the
-- projection keeps resource_saves as `user_saved` because that IS the heart's
-- state on the rendered card. A thread save is asserted alongside to show the
-- untouched branches still feed the same scope.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

-- Author (2222) posts two resources in Fixture A; the Viewer (1111) bookmarks
-- one and merely likes the other — the two actions live in different tables.
insert into public.community_resources (community_id, user_id, title, resource_type, url, created_at) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222',
   'saved fixture resource', 'article', 'https://example.test/saved-fixture', clock_timestamp()),
  ('aaaaaaaa-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222',
   'liked fixture resource', 'article', 'https://example.test/liked-fixture', clock_timestamp());

insert into public.resource_bookmarks (resource_id, user_id)
select id, '11111111-1111-1111-1111-111111111111'
from public.community_resources where title = 'saved fixture resource';

insert into public.resource_saves (resource_id, user_id)
select id, '11111111-1111-1111-1111-111111111111'
from public.community_resources where title = 'liked fixture resource';

insert into public.community_threads (community_id, user_id, title, category, tags, is_public, created_at) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222',
   'saved fixture thread', 'question', array['fixture'], true, clock_timestamp());

insert into public.thread_saves (thread_id, user_id)
select id, '11111111-1111-1111-1111-111111111111'
from public.community_threads where title = 'saved fixture thread';

select is(
  (select count(*)::integer
   from public.get_profile_feed_page(
     '11111111-1111-1111-1111-111111111111'::uuid, 'saved', null, 100) feed
   where feed.item->>'title' = 'saved fixture resource'),
  1,
  'the saved scope lists a resource the member bookmarked'
);

select is(
  (select count(*)::integer
   from public.get_profile_feed_page(
     '11111111-1111-1111-1111-111111111111'::uuid, 'saved', null, 100) feed
   where feed.item->>'title' = 'liked fixture resource'),
  0,
  'a resource the member only liked is not a save'
);

select is(
  (select (feed.item->>'user_bookmarked')::boolean
   from public.get_profile_feed_page(
     '11111111-1111-1111-1111-111111111111'::uuid, 'saved', null, 100) feed
   where feed.item->>'title' = 'saved fixture resource'),
  true,
  'the saved card carries the bookmark state its menu toggles'
);

select is(
  (select (feed.item->>'user_saved')::boolean
   from public.get_profile_feed_page(
     '11111111-1111-1111-1111-111111111111'::uuid, 'saved', null, 100) feed
   where feed.item->>'title' = 'saved fixture resource'),
  false,
  'and leaves the heart state alone: resource_saves is the Like'
);

select is(
  (select count(*)::integer
   from public.get_profile_feed_page(
     '11111111-1111-1111-1111-111111111111'::uuid, 'saved', null, 100) feed
   where feed.item->>'title' = 'saved fixture thread'),
  1,
  'a saved thread still feeds the same scope'
);

select is(
  (select count(*)::integer
   from public.get_profile_feed_page(
     '11111111-1111-1111-1111-111111111111'::uuid, 'all', null, 100) feed
   where feed.item->>'title' = 'saved fixture resource'),
  1,
  'the all scope lists the same bookmark its saved side reads'
);

rollback;

select * from finish();
