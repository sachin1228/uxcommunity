-- ============================================================
-- Community message pagination — the compound (created_at, id) cursor added by
-- 20261013100000_community_message_compound_cursor.sql:
--
--   * the (community_id, created_at, id) index the cursor pages on exists;
--   * exactly ONE overload of get_community_message_page survives, and it is
--     the nine-argument function (the previous seven-argument signature is
--     dropped, never left alongside it — overlapping defaults would make every
--     call ambiguous, the 42725 failure 20260929090000 fixed);
--   * a positional six-argument call still resolves through the defaults, so
--     older deployed callers keep working during a staged deploy;
--   * equal-timestamp messages can never be skipped while paging up OR draining
--     forward — the bug this migration fixes;
--   * a timestamp-only cursor degrades to the previous behaviour (it may
--     re-include equal rows, it never skips them);
--   * more than one page of missed messages drains page by page with no row
--     returned twice and none left behind.
--
-- Fixtures live in a `c0de00eb-` UUID namespace with their own community, so a
-- full-suite run cannot collide with the harness fixtures or with
-- performance_rpcs.test.sql's rows in Fixture A.
-- ============================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- ─── The index the cursor pages on ──────────────────────────
select has_index('public', 'community_messages', 'idx_community_messages_room_time_id',
  'the (community_id, created_at, id) index exists');

-- ─── The signature ──────────────────────────────────────────
select is(
  (select count(*)::integer
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_community_message_page'),
  1,
  'get_community_message_page exposes exactly one overload'
);

select is(
  (select p.pronargs::integer
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_community_message_page'),
  9,
  'the surviving overload takes nine arguments (p_before_id / p_after_id appended)'
);

-- A six-positional-argument call (p_content_ids and both id halves defaulted)
-- is what an older deployed build sends. It must resolve to the single
-- overload rather than raising 42725.
select ok(
  (select count(*) >= 0
     from public.get_community_message_page(
       'c0de00eb-0000-4000-8000-00000000000c'::uuid,
       '11111111-1111-1111-1111-111111111111'::uuid,
       '2026-01-01T00:00:00Z'::timestamptz,
       null, null, 50)),
  'a six-argument call still resolves through the defaults'
);

-- ─── Fixtures ───────────────────────────────────────────────
insert into public.communities (id, name, type, is_active) values
  ('c0de00eb-0000-4000-8000-00000000000c', 'Cursor Fixture', 'city', true),
  ('c0de00eb-0000-4000-8000-00000000000d', 'Drain Fixture', 'city', true);

insert into public.community_members (community_id, user_id, joined_at) values
  ('c0de00eb-0000-4000-8000-00000000000c', '11111111-1111-1111-1111-111111111111', '2026-01-01T00:00:00Z'),
  ('c0de00eb-0000-4000-8000-00000000000d', '11111111-1111-1111-1111-111111111111', '2026-01-01T00:00:00Z');

-- A burst of three messages sharing one timestamp, then one a minute later.
insert into public.community_messages (id, community_id, user_id, content, created_at) values
  ('c0de00eb-0000-4000-8000-000000000201', 'c0de00eb-0000-4000-8000-00000000000c',
   '22222222-2222-2222-2222-222222222222', 'burst a', '2026-06-01T00:00:00Z'),
  ('c0de00eb-0000-4000-8000-000000000202', 'c0de00eb-0000-4000-8000-00000000000c',
   '22222222-2222-2222-2222-222222222222', 'burst b', '2026-06-01T00:00:00Z'),
  ('c0de00eb-0000-4000-8000-000000000203', 'c0de00eb-0000-4000-8000-00000000000c',
   '22222222-2222-2222-2222-222222222222', 'burst c', '2026-06-01T00:00:00Z'),
  ('c0de00eb-0000-4000-8000-000000000204', 'c0de00eb-0000-4000-8000-00000000000c',
   '11111111-1111-1111-1111-111111111111', 'later',   '2026-06-01T00:01:00Z');

-- ─── Newest page ────────────────────────────────────────────
select is(
  (select r.id
     from public.get_community_message_page(
       'c0de00eb-0000-4000-8000-00000000000c', '11111111-1111-1111-1111-111111111111',
       '2026-01-01T00:00:00Z', null, null, 1) r
    limit 1),
  'c0de00eb-0000-4000-8000-000000000204'::uuid,
  'the initial page is newest-first'
);

-- ─── Older page above the newest message ────────────────────
-- Cursor (T1, later-id): every row strictly below it, which is the whole burst.
select is(
  (select string_agg(r.id::text, ',' order by r.created_at desc, r.id desc)
     from public.get_community_message_page(
       p_community_id  => 'c0de00eb-0000-4000-8000-00000000000c',
       p_user_id       => '11111111-1111-1111-1111-111111111111',
       p_history_start => '2026-01-01T00:00:00Z',
       p_before        => '2026-06-01T00:01:00Z',
       p_before_id     => 'c0de00eb-0000-4000-8000-000000000204',
       p_limit         => 5) r),
  'c0de00eb-0000-4000-8000-000000000203,c0de00eb-0000-4000-8000-000000000202,c0de00eb-0000-4000-8000-000000000201',
  'the before cursor returns the equal-timestamp burst without skipping'
);

-- Cursor (T0, burst c): the two equal-timestamp rows BEFORE the cursor row.
-- A timestamp-only cursor cannot express this — it would either re-return the
-- whole burst or lose rows, depending on the comparison.
select is(
  (select count(*)::integer
     from public.get_community_message_page(
       p_community_id  => 'c0de00eb-0000-4000-8000-00000000000c',
       p_user_id       => '11111111-1111-1111-1111-111111111111',
       p_history_start => '2026-01-01T00:00:00Z',
       p_before        => '2026-06-01T00:00:00Z',
       p_before_id     => 'c0de00eb-0000-4000-8000-000000000203',
       p_limit         => 5) r),
  2,
  'paging up from mid-burst returns exactly the two predecessors'
);

select is(
  (select string_agg(r.id::text, ',' order by r.created_at desc, r.id desc)
     from public.get_community_message_page(
       p_community_id  => 'c0de00eb-0000-4000-8000-00000000000c',
       p_user_id       => '11111111-1111-1111-1111-111111111111',
       p_history_start => '2026-01-01T00:00:00Z',
       p_before        => '2026-06-01T00:00:00Z',
       p_before_id     => 'c0de00eb-0000-4000-8000-000000000203',
       p_limit         => 5) r),
  'c0de00eb-0000-4000-8000-000000000202,c0de00eb-0000-4000-8000-000000000201',
  'and they are the right two rows'
);

-- A caller that sends no id half (an older deployed build) gets the safe
-- direction of the degradation: the NULL id becomes the all-ones sentinel, so
-- the comparison is `(T0, id) < (T0, 'ffffffff-...')` and EVERY row at that
-- timestamp is re-included. Erring toward duplicates is recoverable client-side;
-- the strict `<` this replaces could drop the equal rows for good.
select is(
  (select count(*)::integer
     from public.get_community_message_page(
       p_community_id  => 'c0de00eb-0000-4000-8000-00000000000c',
       p_user_id       => '11111111-1111-1111-1111-111111111111',
       p_history_start => '2026-01-01T00:00:00Z',
       p_before        => '2026-06-01T00:00:00Z',
       p_limit         => 5) r),
  3,
  'a timestamp-only before cursor re-includes equal rows, never skipping them'
);

-- ─── Catch-up forward over the burst ────────────────────────
-- Cursor (T0, burst a): everything strictly newer — b, c and the later message.
select is(
  (select count(*)::integer
     from public.get_community_message_page(
       p_community_id  => 'c0de00eb-0000-4000-8000-00000000000c',
       p_user_id       => '11111111-1111-1111-1111-111111111111',
       p_history_start => '2026-01-01T00:00:00Z',
       p_after         => '2026-06-01T00:00:00Z',
       p_after_id      => 'c0de00eb-0000-4000-8000-000000000201',
       p_limit         => 5) r),
  3,
  'the after cursor resumes mid-burst without repeating the cursor row'
);

select is(
  (select r.id
     from public.get_community_message_page(
       p_community_id  => 'c0de00eb-0000-4000-8000-00000000000c',
       p_user_id       => '11111111-1111-1111-1111-111111111111',
       p_history_start => '2026-01-01T00:00:00Z',
       p_after         => '2026-06-01T00:00:00Z',
       p_after_id      => 'c0de00eb-0000-4000-8000-000000000201',
       p_limit         => 5) r
    order by r.created_at asc, r.id asc
    limit 1),
  'c0de00eb-0000-4000-8000-000000000202'::uuid,
  'the drained page starts at the first equal-timestamp successor'
);

-- Cursor (T0, burst c): only the later message is strictly newer.
select is(
  (select count(*)::integer
     from public.get_community_message_page(
       p_community_id  => 'c0de00eb-0000-4000-8000-00000000000c',
       p_user_id       => '11111111-1111-1111-1111-111111111111',
       p_history_start => '2026-01-01T00:00:00Z',
       p_after         => '2026-06-01T00:00:00Z',
       p_after_id      => 'c0de00eb-0000-4000-8000-000000000203',
       p_limit         => 5) r),
  1,
  'a cursor at the last row of the burst advances past it cleanly'
);

select is(
  (select r.id
     from public.get_community_message_page(
       p_community_id  => 'c0de00eb-0000-4000-8000-00000000000c',
       p_user_id       => '11111111-1111-1111-1111-111111111111',
       p_history_start => '2026-01-01T00:00:00Z',
       p_after         => '2026-06-01T00:00:00Z',
       p_after_id      => 'c0de00eb-0000-4000-8000-000000000203',
       p_limit         => 5) r
    limit 1),
  'c0de00eb-0000-4000-8000-000000000204'::uuid,
  'and that row is the later message'
);

-- ─── Draining more than one page of missed messages ─────────
-- 120 messages, 1 ms apart, in their own community: one page is 50, so a
-- catch-up must walk three pages.
insert into public.community_messages (community_id, user_id, content, created_at)
select 'c0de00eb-0000-4000-8000-00000000000d', '22222222-2222-2222-2222-222222222222',
       'drain fixture ' || series.value,
       '2026-07-01T00:00:00Z'::timestamptz + series.value * interval '1 millisecond'
from generate_series(1, 120) as series(value);

create temporary table cursor_page_1 as
select r.* from public.get_community_message_page(
  p_community_id  => 'c0de00eb-0000-4000-8000-00000000000d',
  p_user_id       => '11111111-1111-1111-1111-111111111111',
  p_history_start => '2026-01-01T00:00:00Z',
  p_after         => '2026-06-30T23:59:59Z',
  p_after_id      => '00000000-0000-0000-0000-000000000000',
  p_limit         => 50) r;

create temporary table cursor_page_2 as
select r.* from public.get_community_message_page(
  p_community_id  => 'c0de00eb-0000-4000-8000-00000000000d',
  p_user_id       => '11111111-1111-1111-1111-111111111111',
  p_history_start => '2026-01-01T00:00:00Z',
  p_after         => (select created_at from cursor_page_1 order by created_at desc, id desc limit 1),
  p_after_id      => (select id from cursor_page_1 order by created_at desc, id desc limit 1),
  p_limit         => 50) r;

create temporary table cursor_page_3 as
select r.* from public.get_community_message_page(
  p_community_id  => 'c0de00eb-0000-4000-8000-00000000000d',
  p_user_id       => '11111111-1111-1111-1111-111111111111',
  p_history_start => '2026-01-01T00:00:00Z',
  p_after         => (select created_at from cursor_page_2 order by created_at desc, id desc limit 1),
  p_after_id      => (select id from cursor_page_2 order by created_at desc, id desc limit 1),
  p_limit         => 50) r;

select is((select count(*)::integer from cursor_page_1), 50,
  'the first drained page is a full page');
select is((select count(*)::integer from cursor_page_2), 50,
  'the second drained page is a full page');
select is((select count(*)::integer from cursor_page_3), 20,
  'the third drained page carries the remainder and ends the drain');

select is(
  (select count(distinct id)::integer
     from (select id from cursor_page_1
           union all select id from cursor_page_2
           union all select id from cursor_page_3) drained),
  120,
  'all 120 missed messages are reached across the drained pages'
);

select is(
  (select count(*)::integer
     from (select id from cursor_page_1
           union all select id from cursor_page_2
           union all select id from cursor_page_3) drained),
  120,
  'and no message is returned twice'
);

select * from finish();
rollback;
