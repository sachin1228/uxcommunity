-- library_items + the admin library functions + get_library_page.
--
-- The shelf is admin-curated and cross-community: a picked post reaches a
-- viewer only when the post itself is visible to them (public, or their
-- community), order is a 1..N block per kind, and a deleted post leaves the
-- shelf by cascade. The queue ranks a kind by engagement (likes + comments;
-- resources: saves + comments).
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

-- Creation limits (20261013120000): this fixture posts more than the daily
-- budget allows. Transaction-local, released with this file's rollback.
select set_config('app.bypass_creation_limits', 'on', true);

select has_function('public', 'library_featured_renumber', array['text']);
select has_function('public', 'admin_set_library_item', array['text','uuid','boolean','uuid']);
select has_function('public', 'admin_move_library_item', array['text','uuid','integer']);
select has_function('public', 'admin_library_featured', array[]::text[]);
select has_function('public', 'admin_library_candidates', array['text','text','text','integer','integer']);
select has_function('public', 'get_library_page', array['uuid']);

-- Viewer 1111 is a member of Fixture A; Fixture B is shared with nobody.
insert into public.community_threads
  (id, community_id, user_id, title, category, tags, is_public, created_at) values
  ('c1c1c1c1-0000-4000-8000-000000000001', 'bbbbbbbb-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222',
   'library public thread from B', 'question', array['fixture'], true, clock_timestamp()),
  ('c1c1c1c1-0000-4000-8000-000000000002', 'bbbbbbbb-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222',
   'library private thread from B', 'discussion', array['fixture'], false, clock_timestamp()),
  ('c1c1c1c1-0000-4000-8000-000000000003', 'aaaaaaaa-0000-0000-0000-00000000000a', '22222222-2222-2222-2222-222222222222',
   'library private thread from A', 'idea', array['fixture'], false, clock_timestamp()),
  ('c1c1c1c1-0000-4000-8000-000000000004', 'bbbbbbbb-0000-0000-0000-00000000000b', '33333333-3333-3333-3333-333333333333',
   'library second public thread from B', 'question', array['fixture'], true, clock_timestamp() - interval '1 minute');

insert into public.community_showcase_posts
  (id, community_id, user_id, title, image_url, category, is_public, created_at) values
  ('c1c1c1c1-0000-4000-8000-000000000005', 'bbbbbbbb-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222',
   'library public showcase from B', 'https://example.com/fixture.png', 'ui_design', true, clock_timestamp());

insert into public.community_resources
  (id, community_id, user_id, title, resource_type, url, is_public, created_at) values
  ('c1c1c1c1-0000-4000-8000-000000000006', 'bbbbbbbb-0000-0000-0000-00000000000b', '22222222-2222-2222-2222-222222222222',
   'library public resource from B', 'figma', 'https://example.com/fixture', true, clock_timestamp());

-- Engagement for the queue's ranking: two likes + one comment on thread 1.
insert into public.thread_likes (thread_id, user_id) values
  ('c1c1c1c1-0000-4000-8000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('c1c1c1c1-0000-4000-8000-000000000001', '33333333-3333-3333-3333-333333333333');

insert into public.thread_comments (thread_id, user_id, body) values
  ('c1c1c1c1-0000-4000-8000-000000000001', '33333333-3333-3333-3333-333333333333', 'fixture comment');

-- ── Featuring: append, idempotence, move, remove ────────────

select is(
  public.admin_set_library_item('thread', 'c1c1c1c1-0000-4000-8000-000000000004', true, '11111111-1111-1111-1111-111111111111'),
  1, 'the first pick lands at position 1');

select is(
  public.admin_set_library_item('thread', 'c1c1c1c1-0000-4000-8000-000000000001', true, null),
  2, 'the second pick appends at position 2');

select is(
  public.admin_set_library_item('thread', 'c1c1c1c1-0000-4000-8000-000000000001', true, null),
  2, 're-featuring a post already on the shelf is a no-op returning its position');

select is(
  (select array_agg(item_id order by "position") from public.admin_library_featured() where item_type = 'thread'),
  array['c1c1c1c1-0000-4000-8000-000000000004','c1c1c1c1-0000-4000-8000-000000000001']::uuid[],
  'the shelf lists threads in position order');

select is(
  public.admin_move_library_item('thread', 'c1c1c1c1-0000-4000-8000-000000000001', -1),
  1, 'a move up returns the new position');

select is(
  (select array_agg(item_id order by "position") from public.admin_library_featured() where item_type = 'thread'),
  array['c1c1c1c1-0000-4000-8000-000000000001','c1c1c1c1-0000-4000-8000-000000000004']::uuid[],
  'a move up swaps with the neighbour');

select is(
  public.admin_move_library_item('thread', 'c1c1c1c1-0000-4000-8000-000000000001', -1),
  1, 'a move off the top is a no-op');

select is(
  public.admin_set_library_item('thread', 'c1c1c1c1-0000-4000-8000-000000000004', false, null),
  null, 'unfeaturing returns null');

select is(
  (select count(*)::integer from public.library_items where thread_id = 'c1c1c1c1-0000-4000-8000-000000000004'),
  0, 'unfeaturing removes the shelf row');

select is(
  (select array_agg(featured_rank order by featured_rank) from public.library_items where item_type = 'thread'),
  array[1],
  'renumbering closes the gap a removal leaves');

select is(
  public.admin_set_library_item('thread', 'c1c1c1c1-0000-4000-8000-000000000002', false, null),
  null, 'unfeaturing a post that is not on the shelf is a no-op');

select throws_ok(
  $$select public.admin_set_library_item('thread', 'c1c1c1c1-0000-4000-8000-00000000dead', true, null)$$,
  'P0002', 'item_not_found', 'featuring a post that does not exist is refused');

select throws_ok(
  $$select public.admin_move_library_item('thread', 'c1c1c1c1-0000-4000-8000-000000000002', 1)$$,
  'P0001', 'item_not_featured', 'moving a post that is not on the shelf is refused');

-- ── The queue's engagement ranking ──────────────────────────

select is(
  (select id from public.admin_library_candidates('thread', '', 'engagement', 0, 10) limit 1),
  'c1c1c1c1-0000-4000-8000-000000000001'::uuid,
  'the queue ranks threads by likes + comments first');

select is(
  (select featured from public.admin_library_candidates('thread', '', 'engagement', 0, 10)
   where id = 'c1c1c1c1-0000-4000-8000-000000000001'),
  true, 'the queue flags an on-shelf post');

select is(
  (select like_count from public.admin_library_candidates('thread', '', 'engagement', 0, 10)
   where id = 'c1c1c1c1-0000-4000-8000-000000000001'),
  2::bigint, 'the queue carries the like count');

select is(
  (select total_count from public.admin_library_candidates('thread', 'second public thread from B', 'engagement', 0, 10)),
  1::bigint, 'search narrows the queue and its total');

-- ── Each kind gets its own position block ───────────────────

select is(
  public.admin_set_library_item('showcase', 'c1c1c1c1-0000-4000-8000-000000000005', true, null),
  1, 'the showcase kind has its own position block');

select is(
  public.admin_set_library_item('resource', 'c1c1c1c1-0000-4000-8000-000000000006', true, null),
  1, 'the resource kind has its own position block');

-- ── The member shelf read ───────────────────────────────────

select is(
  public.admin_set_library_item('thread', 'c1c1c1c1-0000-4000-8000-000000000002', true, null),
  2, 'a picked community-only thread from B appends to the thread block');

select is(
  public.admin_set_library_item('thread', 'c1c1c1c1-0000-4000-8000-000000000003', true, null),
  3, 'a picked community-only thread from A appends to the thread block');

select is(
  (select count(*)::integer from public.get_library_page('11111111-1111-1111-1111-111111111111') feed
   where feed.item->>'title' = 'library public thread from B'),
  1, 'the shelf lists a picked public post from an unjoined community');

select is(
  (select count(*)::integer from public.get_library_page('11111111-1111-1111-1111-111111111111') feed
   where feed.item->>'title' = 'library private thread from B'),
  0, 'the shelf hides a picked community-only post from a non-member');

select is(
  (select count(*)::integer from public.get_library_page('11111111-1111-1111-1111-111111111111') feed
   where feed.item->>'title' = 'library private thread from A'),
  1, 'the shelf lists a picked community-only post to a member');

select is(
  (select count(*)::integer from public.get_library_page('33333333-3333-3333-3333-333333333333') feed
   where feed.item->>'title' = 'library private thread from A'),
  0, 'a private post from a community the viewer is not in stays hidden');

select is(
  (select feed.item->>'like_count' from public.get_library_page('11111111-1111-1111-1111-111111111111') feed
   where feed.item->>'title' = 'library public thread from B'),
  '2', 'the shelf resolves like counts for the viewer');

select is(
  (select feed.item->>'user_liked' from public.get_library_page('11111111-1111-1111-1111-111111111111') feed
   where feed.item->>'title' = 'library public thread from B'),
  'true', 'the shelf resolves the viewer''s own like flag');

select is(
  (select feed.item->>'_type' from public.get_library_page('11111111-1111-1111-1111-111111111111') feed limit 1),
  'thread', 'the shelf lists threads before the other kinds');

select is(
  (select feed.item->>'title' from public.get_library_page('11111111-1111-1111-1111-111111111111') feed
   where feed.item->>'_type' = 'showcase'),
  'library public showcase from B', 'the shelf carries picked showcase posts');

select is(
  (select feed.item->>'title' from public.get_library_page('11111111-1111-1111-1111-111111111111') feed
   where feed.item->>'_type' = 'resource'),
  'library public resource from B', 'the shelf carries picked resources');

-- ── Deletion cascades off the shelf ─────────────────────────

delete from public.community_threads where id = 'c1c1c1c1-0000-4000-8000-000000000001';

select is(
  (select count(*)::integer from public.library_items where thread_id = 'c1c1c1c1-0000-4000-8000-000000000001'),
  0, 'deleting a post takes it off the shelf');

select is(
  (select count(*)::integer from public.get_library_page('11111111-1111-1111-1111-111111111111') feed
   where feed.item->>'title' = 'library public thread from B'),
  0, 'a deleted post never reaches the shelf read');

select * from finish();
rollback;
