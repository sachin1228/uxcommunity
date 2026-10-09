-- get_member_feed_page: the member profile feed.
--
-- A member's profile lists the posts they authored, limited to what the
-- viewer may see — the same rule the home feed already uses, unioned:
--   * public cards are listed even from communities the viewer has not
--     joined ("For You"), and
--   * community-only cards are listed only when the viewer is a member of
--     that community ("Your Communities").
-- A member's saves are private and are never a source, and every interaction
-- flag must resolve for the viewer, not the profile owner.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

select has_function('public', 'get_member_feed_page', array['uuid','uuid','text','timestamptz','integer']);

-- Viewer and Author are both members of Fixture A (the harness seeds those
-- memberships), so A is their shared community. Fixture B is shared with
-- neither, so the viewer only reaches public cards there.
insert into public.community_threads
  (community_id, user_id, title, category, tags, is_public, created_at) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222',
   'member feed public shared-community thread', 'question', array['fixture'], true, clock_timestamp()),
  ('aaaaaaaa-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222',
   'member feed private shared-community thread', 'question', array['fixture'], false, clock_timestamp()),
  ('bbbbbbbb-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222',
   'member feed public unshared-community thread', 'question', array['fixture'], true, clock_timestamp()),
  ('bbbbbbbb-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222',
   'member feed private unshared-community thread', 'question', array['fixture'], false, clock_timestamp()),
  ('aaaaaaaa-0000-0000-0000-00000000000a', '33333333-3333-3333-3333-333333333333',
   'member feed third-author thread', 'question', array['fixture'], false, clock_timestamp());

insert into public.community_showcase_posts
  (community_id, user_id, title, image_url, category, is_public, created_at) values
  ('bbbbbbbb-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222',
   'member feed public unshared-community showcase', 'https://example.com/fixture.png', 'ui_design', true, clock_timestamp());

select is(
  (select count(*)::integer
   from public.get_member_feed_page(
     '11111111-1111-1111-1111-111111111111'::uuid,
     '22222222-2222-2222-2222-222222222222'::uuid,
     'all'::text, null, 100) feed
   where feed.item->>'title' = 'member feed public shared-community thread'),
  1,
  'member feed lists the author''s public post from a shared community'
);

select is(
  (select count(*)::integer
   from public.get_member_feed_page(
     '11111111-1111-1111-1111-111111111111'::uuid,
     '22222222-2222-2222-2222-222222222222'::uuid,
     'all'::text, null, 100) feed
   where feed.item->>'title' = 'member feed private shared-community thread'),
  1,
  'member feed lists a community-only post when the viewer is in its community'
);

select is(
  (select count(*)::integer
   from public.get_member_feed_page(
     '11111111-1111-1111-1111-111111111111'::uuid,
     '22222222-2222-2222-2222-222222222222'::uuid,
     'all'::text, null, 100) feed
   where feed.item->>'title' = 'member feed public unshared-community thread'),
  1,
  'member feed lists a public post from a community the viewer has not joined'
);

select is(
  (select count(*)::integer
   from public.get_member_feed_page(
     '11111111-1111-1111-1111-111111111111'::uuid,
     '22222222-2222-2222-2222-222222222222'::uuid,
     'all'::text, null, 100) feed
   where feed.item->>'title' = 'member feed private unshared-community thread'),
  0,
  'member feed hides a community-only post from a community the viewer has not joined'
);

select is(
  (select count(*)::integer
   from public.get_member_feed_page(
     '11111111-1111-1111-1111-111111111111'::uuid,
     '22222222-2222-2222-2222-222222222222'::uuid,
     'all'::text, null, 100) feed
   where feed.item->>'title' = 'member feed third-author thread'),
  0,
  'member feed lists only the profile member''s own posts'
);

-- Saving another author's post must not pull it into the profile feed: saves
-- are the owner's private list, never a source for a member's activity.
insert into public.thread_saves (thread_id, user_id)
select thread.id, '11111111-1111-1111-1111-111111111111'
from public.community_threads thread
where thread.title = 'member feed third-author thread';

select is(
  (select count(*)::integer
   from public.get_member_feed_page(
     '11111111-1111-1111-1111-111111111111'::uuid,
     '22222222-2222-2222-2222-222222222222'::uuid,
     'all'::text, null, 100) feed
   where feed.item->>'title' = 'member feed third-author thread'),
  0,
  'a post by another author the viewer saved is never listed'
);

-- Flags must resolve for the viewer (the reader), never for the owner: the
-- viewer likes one card, the owner likes another, and only the viewer's own
-- like may come back true.
insert into public.thread_likes (thread_id, user_id)
select thread.id, '11111111-1111-1111-1111-111111111111'
from public.community_threads thread
where thread.title = 'member feed private shared-community thread';

insert into public.thread_likes (thread_id, user_id)
select thread.id, '22222222-2222-2222-2222-222222222222'
from public.community_threads thread
where thread.title = 'member feed public unshared-community thread';

select is(
  (select (feed.item->>'user_liked')::boolean
   from public.get_member_feed_page(
     '11111111-1111-1111-1111-111111111111'::uuid,
     '22222222-2222-2222-2222-222222222222'::uuid,
     'all'::text, null, 100) feed
   where feed.item->>'title' = 'member feed private shared-community thread'),
  true,
  'interaction flags resolve for the viewer'
);

select is(
  (select (feed.item->>'user_liked')::boolean
   from public.get_member_feed_page(
     '11111111-1111-1111-1111-111111111111'::uuid,
     '22222222-2222-2222-2222-222222222222'::uuid,
     'all'::text, null, 100) feed
   where feed.item->>'title' = 'member feed public unshared-community thread'),
  false,
  'the owner''s own likes do not leak into the viewer''s flags'
);

select is(
  (select count(*)::integer
   from public.get_member_feed_page(
     '11111111-1111-1111-1111-111111111111'::uuid,
     '22222222-2222-2222-2222-222222222222'::uuid,
     'showcase'::text, null, 100) feed
   where feed.item->>'title' = 'member feed public unshared-community showcase'),
  1,
  'showcase scope lists the author''s public showcase from an unshared community'
);

select is(
  (select count(*)::integer
   from public.get_member_feed_page(
     '11111111-1111-1111-1111-111111111111'::uuid,
     '22222222-2222-2222-2222-222222222222'::uuid,
     'thread'::text, null, 100) feed
   where feed.item->>'title' = 'member feed public unshared-community showcase'),
  0,
  'thread scope excludes showcase cards'
);

select * from finish();
rollback;
