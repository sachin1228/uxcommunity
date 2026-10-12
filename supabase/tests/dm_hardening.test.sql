-- ============================================================
-- Direct messages hardening — the invariants added by
-- 20261012120000_dm_hardening.sql:
--
--   * client_nonce: unique per (sender, nonce), scoped so two senders can
--     reuse the same nonce value;
--   * trigger guards: author must belong to the conversation, replies must
--     stay inside their conversation, reactions must be coherent;
--   * mark_dm_conversation_read: participant-only, monotonic, one side at a
--     time, agreeing with the unread RPCs;
--   * compound (created_at, id) cursors: equal-timestamp messages can never
--     be skipped while paging in either direction.
--
-- Fixtures: harness users Viewer (1111…), Author (2222…), Third (3333…).
-- Rows live in a `deadbe00-` UUID namespace so full-suite runs cannot
-- collide with direct_messages.test.sql's `dec0de00-` fixtures.
-- ============================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- ─── Idempotency: client_nonce ──────────────────────────────
select has_index('public', 'dm_messages', 'idx_dm_messages_sender_nonce',
  'the sender+nonce unique index exists');

insert into public.dm_conversations (id, user_a, user_b) values
  ('deadbe00-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222'),
  ('deadbe00-0000-4000-8000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333');

-- Same nonce value from two different senders is allowed — the key is
-- scoped to the sender, not global.
insert into public.dm_messages (id, conversation_id, user_id, content, created_at, client_nonce) values
  ('deadbe00-0000-4000-8000-000000000101',
   'deadbe00-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'nonce one',
   '2026-01-01T00:00:00Z', 'deadbe00-0000-4000-8000-000000000301'),
  ('deadbe00-0000-4000-8000-000000000102',
   'deadbe00-0000-4000-8000-000000000001',
   '22222222-2222-2222-2222-222222222222', 'nonce two',
   '2026-01-01T01:00:00Z', 'deadbe00-0000-4000-8000-000000000301');

select is(
  (select count(*)::integer
     from public.dm_messages
    where client_nonce = 'deadbe00-0000-4000-8000-000000000301'),
  2,
  'the nonce key is scoped per sender (two senders, same value, both stored)'
);

select throws_ok(
  $$insert into public.dm_messages
      (conversation_id, user_id, content, client_nonce)
    values ('deadbe00-0000-4000-8000-000000000001',
            '11111111-1111-1111-1111-111111111111', 'retry',
            'deadbe00-0000-4000-8000-000000000301')$$,
  '23505',
  'sender nonce unique',
  'a retry with the same sender+nonce is rejected by the database'
);

-- ─── Trigger guards ─────────────────────────────────────────
select throws_ok(
  $$insert into public.dm_messages (conversation_id, user_id, content)
    values ('deadbe00-0000-4000-8000-000000000001',
            '33333333-3333-3333-3333-333333333333', 'not mine')$$,
  '23514',
  'author must be a participant',
  'a message authored by a non-participant is rejected'
);

insert into public.dm_messages (id, conversation_id, user_id, content, reply_to_id, created_at)
values ('deadbe00-0000-4000-8000-000000000103',
        'deadbe00-0000-4000-8000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'reply',
        'deadbe00-0000-4000-8000-000000000101',
        '2026-01-01T01:30:00Z');

select ok(
  exists (select 1 from public.dm_messages
           where id = 'deadbe00-0000-4000-8000-000000000103'),
  'a same-conversation reply inserts cleanly'
);

select throws_ok(
  $$insert into public.dm_messages (conversation_id, user_id, content, reply_to_id)
    values ('deadbe00-0000-4000-8000-000000000002',
            '33333333-3333-3333-3333-333333333333', 'cross reply',
            'deadbe00-0000-4000-8000-000000000101')$$,
  '23514',
  'reply must stay in its conversation',
  'a reply referencing another conversation''s message is rejected'
);

select throws_ok(
  $$insert into public.dm_message_reactions
      (message_id, conversation_id, user_id, emoji)
    values ('deadbe00-0000-4000-8000-000000000101',
            'deadbe00-0000-4000-8000-000000000001',
            '33333333-3333-3333-3333-333333333333', 'x')$$,
  '23514',
  'reactor must be a participant',
  'a reaction from a non-participant is rejected'
);

select throws_ok(
  $$insert into public.dm_message_reactions
      (message_id, conversation_id, user_id, emoji)
    values ('deadbe00-0000-4000-8000-000000000101',
            'deadbe00-0000-4000-8000-000000000002',
            '11111111-1111-1111-1111-111111111111', 'x')$$,
  '23514',
  'reaction conversation must match the message',
  'a reaction carrying a foreign conversation id is rejected'
);

-- ─── mark_dm_conversation_read ──────────────────────────────
select throws_ok(
  $$select * from public.mark_dm_conversation_read(
      'deadbe00-0000-4000-8000-000000000001',
      '33333333-3333-3333-3333-333333333333',
      '2026-01-01T02:00:00Z')$$,
  '42501',
  'not a participant',
  'a non-participant cannot advance someone else''s marker'
);

select throws_ok(
  $$select * from public.mark_dm_conversation_read(
      'deadbe00-0000-4000-8000-0000000000ff',
      '11111111-1111-1111-1111-111111111111',
      '2026-01-01T02:00:00Z')$$,
  'P0002',
  'conversation not found',
  'marking an unknown conversation raises instead of silently passing'
);

select is(
  (select r.marked_at from public.mark_dm_conversation_read(
     'deadbe00-0000-4000-8000-000000000001',
     '11111111-1111-1111-1111-111111111111',
     '2026-01-01T02:00:00Z') r),
  '2026-01-01T02:00:00Z'::timestamptz,
  'marking forward stores the displayed message''s timestamp'
);

select is(
  (select r.marked_at from public.mark_dm_conversation_read(
     'deadbe00-0000-4000-8000-000000000001',
     '11111111-1111-1111-1111-111111111111',
     '2025-01-01T00:00:00Z') r),
  '2026-01-01T02:00:00Z'::timestamptz,
  'a stale backwards request cannot move the marker backwards'
);

select is(
  (select c.user_b_last_read_at from public.dm_conversations c
    where c.id = 'deadbe00-0000-4000-8000-000000000001'),
  null,
  'marking one side read leaves the other side untouched'
);

-- ─── Compound cursors ───────────────────────────────────────
-- Three messages share one timestamp; a fourth is one minute newer.
insert into public.dm_messages (id, conversation_id, user_id, content, created_at) values
  ('deadbe00-0000-4000-8000-000000000201',
   'deadbe00-0000-4000-8000-000000000002',
   '33333333-3333-3333-3333-333333333333', 'burst a', '2026-06-01T00:00:00Z'),
  ('deadbe00-0000-4000-8000-000000000202',
   'deadbe00-0000-4000-8000-000000000002',
   '33333333-3333-3333-3333-333333333333', 'burst b', '2026-06-01T00:00:00Z'),
  ('deadbe00-0000-4000-8000-000000000203',
   'deadbe00-0000-4000-8000-000000000002',
   '33333333-3333-3333-3333-333333333333', 'burst c', '2026-06-01T00:00:00Z'),
  ('deadbe00-0000-4000-8000-000000000204',
   'deadbe00-0000-4000-8000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'later', '2026-06-01T00:01:00Z');

select is(
  (select r.id from public.get_dm_message_page(
     'deadbe00-0000-4000-8000-000000000002',
     '11111111-1111-1111-1111-111111111111',
     null, null, null, null, 1) r
   limit 1),
  'deadbe00-0000-4000-8000-000000000204'::uuid,
  'the initial page is newest-first'
);

select is(
  (select string_agg(r.id::text, ',' order by r.created_at desc, r.id desc)
     from public.get_dm_message_page(
       'deadbe00-0000-4000-8000-000000000002',
       '11111111-1111-1111-1111-111111111111',
       '2026-06-01T00:00:00Z', 'deadbe00-0000-4000-8000-000000000203',
       null, null, 5) r),
  'deadbe00-0000-4000-8000-000000000202,deadbe00-0000-4000-8000-000000000201',
  'the before cursor returns the equal-timestamp predecessors without skipping'
);

select is(
  (select count(*)::integer
     from public.get_dm_message_page(
       'deadbe00-0000-4000-8000-000000000002',
       '11111111-1111-1111-1111-111111111111',
       null, null,
       '2026-06-01T00:00:00Z', 'deadbe00-0000-4000-8000-000000000201', 10) r),
  3,
  'the after cursor resumes mid-burst without skipping or repeating the cursor row'
);

select is(
  (select string_agg(r.id::text, ',' order by r.created_at desc, r.id desc)
     from public.get_dm_message_page(
       'deadbe00-0000-4000-8000-000000000002',
       '11111111-1111-1111-1111-111111111111',
       null, null,
       '2026-06-01T00:00:00Z', 'deadbe00-0000-4000-8000-000000000202', 2) r),
  'deadbe00-0000-4000-8000-000000000204,deadbe00-0000-4000-8000-000000000203',
  'catching up a single page across the burst lands exactly on the boundary'
);

select is(
  (select count(*)::integer
     from public.get_dm_message_page(
       'deadbe00-0000-4000-8000-000000000002',
       '11111111-1111-1111-1111-111111111111',
       '2026-06-01T00:00:00Z', null, null, null, 10) r),
  3,
  'a timestamp-only before cursor can only re-include equal rows, never skip them'
);

-- The badge agrees with the markers: conversation 1 was marked read above
-- (its peer messages predate the marker), conversation 2 never was — Third's
-- burst is still unread.
select is(
  public.get_dm_unread_total('11111111-1111-1111-1111-111111111111'),
  1,
  'the unread badge counts exactly the conversations whose marker trails their messages'
);

select * from finish();
rollback;
