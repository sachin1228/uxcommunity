-- Stage 4 AUD-P2 — home feed keyset pagination and branch bounds.
--
-- Two same-timestamp rows used to be skipped between pages because the cursor
-- only carried `created_at` while the order was `(created_at desc, id desc)`.
-- The 5-argument overload carries the id half; this file proves the boundary
-- and that the new indexes exist.

select plan(11);

-- ─── Fixture ────────────────────────────────────────────────
delete from public.communities where id = 'a2a2a2a2-0000-4000-8000-000000000001';
delete from public.users where id in (
  'a2a2a2a2-0000-4000-8000-000000000011',
  'a2a2a2a2-0000-4000-8000-000000000012'
);

insert into public.users (id, name, email, password_hash) values
  ('a2a2a2a2-0000-4000-8000-000000000011', 'Feed viewer', 'feed-viewer@stage4.test', 'x'),
  ('a2a2a2a2-0000-4000-8000-000000000012', 'Feed author', 'feed-author@stage4.test', 'x');

insert into public.communities (id, name, type, owner_id, is_public) values
  ('a2a2a2a2-0000-4000-8000-000000000001', 'Feed bench', 'user',
   'a2a2a2a2-0000-4000-8000-000000000011', true);

insert into public.community_members (community_id, user_id, role) values
  ('a2a2a2a2-0000-4000-8000-000000000001', 'a2a2a2a2-0000-4000-8000-000000000011', 'owner');

insert into public.community_threads (id, community_id, user_id, title, category, created_at, is_public) values
  ('a2a2a2a2-0000-4000-8000-000000000021', 'a2a2a2a2-0000-4000-8000-000000000001',
   'a2a2a2a2-0000-4000-8000-000000000012', 'Older', 'discussion',
   '2026-11-01T10:00:00Z', false),
  ('a2a2a2a2-0000-4000-8000-000000000022', 'a2a2a2a2-0000-4000-8000-000000000001',
   'a2a2a2a2-0000-4000-8000-000000000012', 'Same timestamp A', 'discussion',
   '2026-11-02T10:00:00Z', false),
  ('a2a2a2a2-0000-4000-8000-000000000023', 'a2a2a2a2-0000-4000-8000-000000000001',
   'a2a2a2a2-0000-4000-8000-000000000012', 'Same timestamp B', 'discussion',
   '2026-11-02T10:00:00Z', false);

-- ─── Page 1: newest id on the shared timestamp ──────────────
select is(
  (select item->>'id' from public.get_home_feed_page(
     'a2a2a2a2-0000-4000-8000-000000000011', null, null, 1, 'communities')),
  'a2a2a2a2-0000-4000-8000-000000000023',
  'page 1 takes the highest id on the boundary timestamp'
);

-- ─── Page 2: the equal-timestamp sibling is not skipped ─────
select is(
  (select item->>'id' from public.get_home_feed_page(
     'a2a2a2a2-0000-4000-8000-000000000011',
     '2026-11-02T10:00:00Z', 'a2a2a2a2-0000-4000-8000-000000000023', 1, 'communities')),
  'a2a2a2a2-0000-4000-8000-000000000022',
  'the id half returns the other row sharing the timestamp'
);

select is(
  (select item->>'id' from public.get_home_feed_page(
     'a2a2a2a2-0000-4000-8000-000000000011',
     '2026-11-02T10:00:00Z', 'a2a2a2a2-0000-4000-8000-000000000022', 1, 'communities')),
  'a2a2a2a2-0000-4000-8000-000000000021',
  'the next page continues below the shared timestamp'
);

select is(
  (select count(*)::integer from public.get_home_feed_page(
     'a2a2a2a2-0000-4000-8000-000000000011',
     '2026-11-01T10:00:00Z', 'a2a2a2a2-0000-4000-8000-000000000021', 5, 'communities')),
  0,
  'the final page is empty'
);

-- ─── Legacy timestamp-only overload still resolves ──────────
select is(
  (select count(*)::integer from public.get_home_feed_page(
     'a2a2a2a2-0000-4000-8000-000000000011', null, 10, 'communities')),
  3,
  'the 4-argument overload remains callable'
);

select is(
  (select count(*)::integer from public.get_home_feed_page(
     'a2a2a2a2-0000-4000-8000-000000000011',
     '2026-11-02T10:00:00Z', 'a2a2a2a2-0000-4000-8000-000000000023', 10, 'communities')),
  2,
  'the 5-argument overload returns the remaining rows'
);

-- ─── Indexes backing the bounded branches ───────────────────
select has_index('public', 'community_events', 'idx_community_events_created_id',
  'events have a global (created_at, id) order');
select has_index('public', 'community_events', 'idx_community_events_public_created_id',
  'public events have a partial (created_at, id) order');
select has_index('public', 'community_resources', 'idx_community_resources_created_id',
  'resources have a global (created_at, id) order');
select has_index('public', 'community_resources', 'idx_community_resources_public_created_id',
  'public resources have a partial (created_at, id) order');
select has_index('public', 'community_showcase_posts', 'idx_community_showcase_public_created_id',
  'public showcase posts have a partial (created_at, id) order');

-- ─── Cleanup ────────────────────────────────────────────────
delete from public.communities where id = 'a2a2a2a2-0000-4000-8000-000000000001';
delete from public.users where id in (
  'a2a2a2a2-0000-4000-8000-000000000011',
  'a2a2a2a2-0000-4000-8000-000000000012'
);

select * from finish();
