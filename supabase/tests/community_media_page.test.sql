-- get_community_media_page: the community Media tab's feed.
--
-- Dedicated UUID namespace ed1a… (never shared with other test files): two
-- communities, their memberships, and the content rows all live here, so
-- assertions are immune to rows other files add to the shared fixtures.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

select has_function('public', 'get_community_media_page', array['uuid','uuid','timestamptz','text','uuid','integer','integer']);

-- ── Fixtures ────────────────────────────────────────────────────────────────
-- Viewer (1111…) and Author (2222…) are members of Media-1; Viewer is also a
-- member of Media-2. Third (3333…) is a member of neither.
insert into public.communities (id, name, type, is_active) values
  ('ed1a0000-0000-0000-0000-000000000001', 'Media Fixture 1', 'city', true),
  ('ed1a0000-0000-0000-0000-000000000002', 'Media Fixture 2', 'city', true)
on conflict (id) do nothing;

insert into public.community_members (community_id, user_id, joined_at) values
  ('ed1a0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', now() - interval '10 days'),
  ('ed1a0000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', now() - interval '10 days'),
  ('ed1a0000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111', now() - interval '10 days')
on conflict (community_id, user_id) do nothing;

-- T1: two images around a pdf (image, pdf, image) — the pdf must not appear
-- and the images must keep ordinals 1 and 3.
insert into public.community_threads
  (id, community_id, user_id, title, category, attachments, created_at) values
  ('ed1a0000-0000-0000-0000-000000000011', 'ed1a0000-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222', 'Media fixture thread', 'discussion',
   '[{"name":"a.png","url":"https://example.test/m/t1-a.png","type":"image/png","size":1},
     {"name":"doc.pdf","url":"https://example.test/m/t1-doc.pdf","type":"application/pdf","size":1},
     {"name":"b.gif","url":"https://example.test/m/t1-b.gif","type":"image/gif","size":1}]'::jsonb,
   '2026-01-01 10:00:00+00');

-- T2: lives in Media-2 — must never leak into Media-1's page.
insert into public.community_threads
  (id, community_id, user_id, title, category, attachments, created_at) values
  ('ed1a0000-0000-0000-0000-000000000012', 'ed1a0000-0000-0000-0000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'Media fixture thread 2', 'discussion',
   '[{"name":"a.png","url":"https://example.test/m/t2-a.png","type":"image/png","size":1}]'::jsonb,
   '2026-01-05 10:00:00+00');

-- P1: image + video attachment, with image_url equal to the first attachment
-- (legacy column mirrors the attachment — must not double-count).
insert into public.community_showcase_posts
  (id, community_id, user_id, title, image_url, attachments, category, is_public, created_at) values
  ('ed1a0000-0000-0000-0000-000000000021', 'ed1a0000-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222', 'Media fixture showcase', 'https://example.test/m/p1-live.png',
   '[{"name":"p1-live.png","url":"https://example.test/m/p1-live.png","type":"image/png","size":1},
     {"name":"clip.mp4","url":"https://example.test/m/p1-clip.mp4","type":"video/mp4","size":1,"poster":"https://example.test/m/p1-poster.jpg"}]'::jsonb,
   'ui_design', true, '2026-01-02 10:00:00+00');

-- P2: legacy single-image post with no attachments.
insert into public.community_showcase_posts
  (id, community_id, user_id, title, image_url, attachments, category, is_public, created_at) values
  ('ed1a0000-0000-0000-0000-000000000022', 'ed1a0000-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222', 'Media fixture legacy', 'https://example.test/m/p2-legacy.png',
   '[]'::jsonb, 'ui_design', true, '2026-01-03 10:00:00+00');

-- E1 carries a cover; E2 does not and must not appear.
insert into public.community_events
  (id, community_id, user_id, title, event_date, cover_image_url, created_at) values
  ('ed1a0000-0000-0000-0000-000000000031', 'ed1a0000-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222', 'Media fixture event', '2026-02-01 10:00:00+00',
   'https://example.test/m/e1-cover.png', '2026-01-04 10:00:00+00'),
  ('ed1a0000-0000-0000-0000-000000000032', 'ed1a0000-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222', 'Media fixture event without cover', '2026-02-02 10:00:00+00',
   null, '2026-01-06 10:00:00+00');

-- ── Membership gate ─────────────────────────────────────────────────────────
select throws_ok(
  $$select * from public.get_community_media_page(
      'ed1a0000-0000-0000-0000-000000000001'::uuid,
      '33333333-3333-3333-3333-333333333333'::uuid)$$,
  '42501',
  'Not a member of this community.',
  'a non-member cannot read the media page'
);

-- ── Media-1: six items, newest first ────────────────────────────────────────
select is(
  (select count(*)::integer
   from public.get_community_media_page(
     'ed1a0000-0000-0000-0000-000000000001'::uuid,
     '11111111-1111-1111-1111-111111111111'::uuid, null, null, null, null, 120)),
  6,
  'a full page lists all six media items'
);

select is(
  (select array_agg(feed.item->>'url')
   from public.get_community_media_page(
     'ed1a0000-0000-0000-0000-000000000001'::uuid,
     '11111111-1111-1111-1111-111111111111'::uuid, null, null, null, null, 120) feed),
  array[
    'https://example.test/m/e1-cover.png',
    'https://example.test/m/p2-legacy.png',
    'https://example.test/m/p1-live.png',
    'https://example.test/m/p1-clip.mp4',
    'https://example.test/m/t1-a.png',
    'https://example.test/m/t1-b.gif'
  ],
  'items come back newest first: event cover, legacy image, showcase image + video, thread images'
);

select is(
  (select count(*)::integer
   from public.get_community_media_page(
     'ed1a0000-0000-0000-0000-000000000001'::uuid,
     '11111111-1111-1111-1111-111111111111'::uuid, null, null, null, null, 120) feed
   where feed.item->>'media_type' = 'application/pdf'),
  0,
  'non-image thread attachments (pdf) are not media'
);

select is(
  (select (feed.item->>'media_type') || '|' || (feed.item->>'poster')
   from public.get_community_media_page(
     'ed1a0000-0000-0000-0000-000000000001'::uuid,
     '11111111-1111-1111-1111-111111111111'::uuid, null, null, null, null, 120) feed
   where feed.item->>'url' = 'https://example.test/m/p1-clip.mp4'),
  'video/mp4|https://example.test/m/p1-poster.jpg',
  'a showcase video keeps its mime type and poster frame'
);

select is(
  (select count(*)::integer
   from public.get_community_media_page(
     'ed1a0000-0000-0000-0000-000000000001'::uuid,
     '11111111-1111-1111-1111-111111111111'::uuid, null, null, null, null, 120) feed
   where feed.item->>'url' = 'https://example.test/m/p1-live.png'),
  1,
  'a legacy image_url equal to an attachment URL is not double-counted'
);

select is(
  (select feed.item->>'media_type'
   from public.get_community_media_page(
     'ed1a0000-0000-0000-0000-000000000001'::uuid,
     '11111111-1111-1111-1111-111111111111'::uuid, null, null, null, null, 120) feed
   where feed.item->>'url' = 'https://example.test/m/p2-legacy.png'),
  'image/*',
  'a legacy attachment-less showcase post contributes its stored image'
);

select is(
  (select array_agg((feed.item->>'ordinal')::integer order by (feed.item->>'ordinal')::integer)
   from public.get_community_media_page(
     'ed1a0000-0000-0000-0000-000000000001'::uuid,
     '11111111-1111-1111-1111-111111111111'::uuid, null, null, null, null, 120) feed
   where feed.item->>'source_id' = 'ed1a0000-0000-0000-0000-000000000011'),
  array[1, 3],
  'thread image ordinals keep the attachment positions around the pdf'
);

select is(
  (select feed.item->'author'->>'name'
   from public.get_community_media_page(
     'ed1a0000-0000-0000-0000-000000000001'::uuid,
     '11111111-1111-1111-1111-111111111111'::uuid, null, null, null, null, 120) feed
   where feed.item->>'url' = 'https://example.test/m/e1-cover.png'),
  'Author',
  'each item resolves its author for the viewer'
);

-- ── Community scoping ───────────────────────────────────────────────────────
select is(
  (select count(*)::integer
   from public.get_community_media_page(
     'ed1a0000-0000-0000-0000-000000000002'::uuid,
     '11111111-1111-1111-1111-111111111111'::uuid, null, null, null, null, 120) feed),
  1,
  'a second community sees only its own media'
);

select is(
  (select array_agg(feed.item->>'url')
   from public.get_community_media_page(
     'ed1a0000-0000-0000-0000-000000000001'::uuid,
     '11111111-1111-1111-1111-111111111111'::uuid, null, null, null, null, 120) feed
   where feed.item->>'url' = 'https://example.test/m/t2-a.png'),
  null::text[],
  'the other community''s media never leaks into this page'
);

-- ── Keyset pagination across the composite cursor ───────────────────────────
select is(
  (select count(*)::integer
   from public.get_community_media_page(
     'ed1a0000-0000-0000-0000-000000000001'::uuid,
     '11111111-1111-1111-1111-111111111111'::uuid, null, null, null, null, 2)),
  2,
  'page one honours the page size'
);

select is(
  (select feed.item->>'url'
   from public.get_community_media_page(
     'ed1a0000-0000-0000-0000-000000000001'::uuid,
     '11111111-1111-1111-1111-111111111111'::uuid,
     '2026-01-03 10:00:00+00'::timestamptz, 'showcase',
     'ed1a0000-0000-0000-0000-000000000022'::uuid, 0, 120) feed
   order by feed.item->>'url'
   limit 1),
  'https://example.test/m/p1-clip.mp4',
  'page two resumes strictly after the cursor tuple'
);

select is(
  (select count(*)::integer
   from public.get_community_media_page(
     'ed1a0000-0000-0000-0000-000000000001'::uuid,
     '11111111-1111-1111-1111-111111111111'::uuid,
     '2026-01-03 10:00:00+00'::timestamptz, 'showcase',
     'ed1a0000-0000-0000-0000-000000000022'::uuid, 0, 120)),
  4,
  'page two carries the remaining four items with no overlap'
);

select * from finish();
rollback;
