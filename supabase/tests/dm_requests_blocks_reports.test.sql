-- ============================================================
-- DM requests, blocks and reports — the invariants added by
-- 20261015100000_dm_requests_blocks_reports.sql:
--
--   * get_or_create starts a conversation `pending`; the first message
--     defines the requester; the requester holds exactly one message until
--     the other participant replies (= acceptance) or the request is
--     answered; rejected conversations accept nothing;
--   * dm_blocks: no self-block, one row per pair, and a blocked pair accepts
--     no new message from either side;
--   * the list + unread RPCs omit rejected conversations (both sides) and
--     the viewer's blocked peers (blocker only);
--   * dm_reports: one open report per (reporter, reported user), reasons
--     constrained, snapshot stored, queue view resolves both names.
--
-- Fixtures: harness users Viewer (1111…), Author (2222…), Third (3333…).
-- Rows live in a `daba5e00-` UUID namespace so full-suite runs cannot
-- collide with the other DM files' `dec0de00-` / `deadbe00-` fixtures.
-- ============================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(32);

-- ─── Schema ─────────────────────────────────────────────────
-- (has_column is not among the harness stand-ins — plain ok/exists instead.)
select ok(
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'dm_conversations'
       and column_name = 'request_state'
  ),
  'dm_conversations carries request_state'
);
select ok(
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'dm_conversations'
       and column_name = 'requested_by'
  ),
  'dm_conversations carries requested_by'
);
select has_index('public', 'user_blocks', 'user_blocks_pair_unique',
  'one block row per pair');
select has_index('public', 'dm_reports', 'dm_reports_pending_unique',
  'one open report per reporter per reported user');

-- ─── get_or_create starts the request flow ──────────────────
-- Users 1111/2222 → conv A, 1111/3333 → conv B, 2222/3333 → conv C.
select is(
  (select r.request_state from public.get_or_create_dm_conversation(
     '11111111-1111-1111-1111-111111111111',
     '22222222-2222-2222-2222-222222222222') r),
  'pending',
  'a conversation created through the app starts pending'
);

select is(
  (select r.requested_by from public.get_or_create_dm_conversation(
     '11111111-1111-1111-1111-111111111111',
     '22222222-2222-2222-2222-222222222222') r),
  null::uuid,
  'no requester exists before the first message'
);

-- ─── The request state machine ──────────────────────────────
-- First message from 1111 → becomes the requester.
insert into public.dm_messages (id, conversation_id, user_id, content, created_at)
select 'daba5e00-0000-4000-8000-000000000101', c.id,
       '11111111-1111-1111-1111-111111111111', 'hi', '2026-10-01T00:00:00Z'
  from public.dm_conversations c
 where c.user_a = '11111111-1111-1111-1111-111111111111'
   and c.user_b = '22222222-2222-2222-2222-222222222222';

select is(
  (select c.requested_by from public.dm_conversations c
    where c.user_a = '11111111-1111-1111-1111-111111111111'
      and c.user_b = '22222222-2222-2222-2222-222222222222'),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the first message''s author becomes the requester'
);

select ok(
  exists (
    select 1 from public.dm_messages
     where id = 'daba5e00-0000-4000-8000-000000000101'
  ),
  'the requester''s single message lands'
);

-- A second message from the requester while pending is refused.
select throws_ok(
  $$insert into public.dm_messages (conversation_id, user_id, content)
    select c.id, '11111111-1111-1111-1111-111111111111', 'again'
      from public.dm_conversations c
     where c.user_a = '11111111-1111-1111-1111-111111111111'
       and c.user_b = '22222222-2222-2222-2222-222222222222'$$,
  '23514',
  'one message until the request is accepted',
  'the requester cannot send a second message while pending'
);

-- A reply from the other participant IS the acceptance.
insert into public.dm_messages (id, conversation_id, user_id, content, created_at)
select 'daba5e00-0000-4000-8000-000000000102', c.id,
       '22222222-2222-2222-2222-222222222222', 'hey', '2026-10-01T00:05:00Z'
  from public.dm_conversations c
 where c.user_a = '11111111-1111-1111-1111-111111111111'
   and c.user_b = '22222222-2222-2222-2222-222222222222';

select is(
  (select c.request_state from public.dm_conversations c
    where c.user_a = '11111111-1111-1111-1111-111111111111'
      and c.user_b = '22222222-2222-2222-2222-222222222222'),
  'accepted',
  'a reply from the recipient implicitly accepts the request'
);

select is(
  (select count(*)::integer
     from public.dm_messages m
     join public.dm_conversations c on c.id = m.conversation_id
    where c.user_a = '11111111-1111-1111-1111-111111111111'
      and c.user_b = '22222222-2222-2222-2222-222222222222'),
  2,
  'the live request holds exactly one message from each side'
);

-- Once accepted, the requester can send freely.
insert into public.dm_messages (id, conversation_id, user_id, content, created_at)
select 'daba5e00-0000-4000-8000-000000000103', c.id,
       '11111111-1111-1111-1111-111111111111', 'now free', '2026-10-01T00:10:00Z'
  from public.dm_conversations c
 where c.user_a = '11111111-1111-1111-1111-111111111111'
   and c.user_b = '22222222-2222-2222-2222-222222222222';

select ok(
  exists (select 1 from public.dm_messages
           where id = 'daba5e00-0000-4000-8000-000000000103'),
  'after acceptance the requester sends again without the cap'
);

-- ─── Rejected conversations accept nothing ──────────────────
-- Conv B (1111/3333) and conv C (2222/3333) start accepted (direct inserts
-- predate the request flow — the column default), get one message each way,
-- then conv C is flipped rejected.
insert into public.dm_conversations (id, user_a, user_b) values
  ('daba5e00-0000-4000-8000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333'),
  ('daba5e00-0000-4000-8000-000000000003',
   '22222222-2222-2222-2222-222222222222',
   '33333333-3333-3333-3333-333333333333');

insert into public.dm_messages (id, conversation_id, user_id, content, created_at) values
  ('daba5e00-0000-4000-8000-000000000201',
   'daba5e00-0000-4000-8000-000000000002',
   '33333333-3333-3333-3333-333333333333', 'b from third', '2026-10-02T00:00:00Z'),
  ('daba5e00-0000-4000-8000-000000000202',
   'daba5e00-0000-4000-8000-000000000002',
   '11111111-1111-1111-1111-111111111111', 'b from viewer', '2026-10-02T00:05:00Z'),
  ('daba5e00-0000-4000-8000-000000000301',
   'daba5e00-0000-4000-8000-000000000003',
   '22222222-2222-2222-2222-222222222222', 'c from author', '2026-10-03T00:00:00Z'),
  ('daba5e00-0000-4000-8000-000000000302',
   'daba5e00-0000-4000-8000-000000000003',
   '33333333-3333-3333-3333-333333333333', 'c from third', '2026-10-03T00:05:00Z');

update public.dm_conversations
   set request_state = 'rejected',
       requested_by = '22222222-2222-2222-2222-222222222222'
 where id = 'daba5e00-0000-4000-8000-000000000003';

select throws_ok(
  $$insert into public.dm_messages (conversation_id, user_id, content)
    values ('daba5e00-0000-4000-8000-000000000003',
            '22222222-2222-2222-2222-222222222222', 'one more try')$$,
  '23514',
  'message request was declined',
  'the rejected request''s sender cannot keep messaging'
);

select throws_ok(
  $$insert into public.dm_messages (conversation_id, user_id, content)
    values ('daba5e00-0000-4000-8000-000000000003',
            '33333333-3333-3333-3333-333333333333', 'and me')$$,
  '23514',
  'message request was declined',
  'the member who rejected cannot write into it either'
);

-- ─── Blocks ─────────────────────────────────────────────────
select throws_ok(
  $$insert into public.dm_blocks (blocker_id, blocked_id)
    values ('11111111-1111-1111-1111-111111111111',
            '11111111-1111-1111-1111-111111111111')$$,
  '23514',
  'dm_blocks_no_self',
  'a member cannot block themselves'
);

-- 1111 blocks 3333 → conv B (1111/3333).
insert into public.dm_blocks (blocker_id, blocked_id)
values ('11111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333');

select ok(
  exists (select 1 from public.dm_blocks
           where blocker_id = '11111111-1111-1111-1111-111111111111'
             and blocked_id = '33333333-3333-3333-3333-333333333333'),
  'the block row lands'
);

select throws_ok(
  $$insert into public.dm_blocks (blocker_id, blocked_id)
    values ('11111111-1111-1111-1111-111111111111',
            '33333333-3333-3333-3333-333333333333')$$,
  '23505',
  'dm_blocks_pair_unique',
  'blocking again is refused by the unique pair'
);

select throws_ok(
  $$insert into public.dm_messages (conversation_id, user_id, content)
    values ('daba5e00-0000-4000-8000-000000000002',
            '33333333-3333-3333-3333-333333333333', 'still here?')$$,
  '23514',
  'blocked conversations cannot receive messages',
  'the blocked member cannot send into the blocked conversation'
);

select throws_ok(
  $$insert into public.dm_messages (conversation_id, user_id, content)
    values ('daba5e00-0000-4000-8000-000000000002',
            '11111111-1111-1111-1111-111111111111', 'go away')$$,
  '23514',
  'blocked conversations cannot receive messages',
  'the blocker cannot send into it either while the block stands'
);

-- ─── List + unread filters ──────────────────────────────────
-- Viewer 1111: conv A only — conv B is blocked by them, conv C is not theirs.
select is(
  (select count(*)::integer from public.get_dm_conversations(
     '11111111-1111-1111-1111-111111111111')),
  1,
  'the blocker''s list drops the blocked conversation'
);

select is(
  (select r.request_state from public.get_dm_conversations(
     '11111111-1111-1111-1111-111111111111') r),
  'accepted',
  'the list carries the request state'
);

select is(
  (select r.requested_by from public.get_dm_conversations(
     '11111111-1111-1111-1111-111111111111') r),
  '11111111-1111-1111-1111-111111111111'::uuid,
  'the list carries the requester'
);

-- Third 3333 was blocked: the conversation stays visible to THEM (their own
-- history), but conv C is rejected so it is gone from their list too.
select is(
  (select count(*)::integer from public.get_dm_conversations(
     '33333333-3333-3333-3333-333333333333')),
  1,
  'the blocked member keeps the conversation; the rejected one is hidden from both'
);

-- Author 2222: conv A (pending request from... (accepted)) + conv C rejected.
select is(
  (select count(*)::integer from public.get_dm_conversations(
     '22222222-2222-2222-2222-222222222222')),
  1,
  'a rejected conversation is hidden from the recipient''s list as well'
);

select is(
  public.get_dm_unread_total('11111111-1111-1111-1111-111111111111'),
  1,
  'the unread badge ignores the blocked conversation'
);

select is(
  public.get_dm_unread_total('22222222-2222-2222-2222-222222222222'),
  1,
  'the unread badge ignores the rejected conversation (conv A alone would be 2)'
);

-- ─── Reports ────────────────────────────────────────────────
insert into public.dm_reports
  (id, reporter_id, reported_user_id, conversation_id, reason, details, message_snapshot)
select
  'daba5e00-0000-4000-8000-000000000401',
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  c.id,
  'harassment', 'kept sending things',
  '[{"id": "daba5e00-0000-4000-8000-000000000101", "author_name": "Viewer", "content": "hi"}]'::jsonb
from public.dm_conversations c
where c.user_a = '11111111-1111-1111-1111-111111111111'
  and c.user_b = '22222222-2222-2222-2222-222222222222';

select ok(
  exists (select 1 from public.dm_reports
           where id = 'daba5e00-0000-4000-8000-000000000401'),
  'a report row lands'
);

select throws_ok(
  $$insert into public.dm_reports (reporter_id, reported_user_id, reason)
    values ('11111111-1111-1111-1111-111111111111',
            '22222222-2222-2222-2222-222222222222', 'spam')$$,
  '23505',
  'dm_reports_pending_unique',
  'a second open report on the same member is refused'
);

select throws_ok(
  $$insert into public.dm_reports (reporter_id, reported_user_id, reason)
    values ('33333333-3333-3333-3333-333333333333',
            '22222222-2222-2222-2222-222222222222', 'not_a_reason')$$,
  '23514',
  'dm_reports_reason_check',
  'an unknown reason is refused'
);

select is(
  (select q.reporter_name from public.dm_report_queue q
    where q.id = 'daba5e00-0000-4000-8000-000000000401'),
  'Viewer',
  'the queue view resolves the reporter''s name'
);

select is(
  (select q.reported_user_name from public.dm_report_queue q
    where q.id = 'daba5e00-0000-4000-8000-000000000401'),
  'Author',
  'the queue view resolves the reported member''s name'
);

select is(
  (select jsonb_array_length(q.message_snapshot) from public.dm_report_queue q
    where q.id = 'daba5e00-0000-4000-8000-000000000401'),
  1,
  'the queue view carries the message snapshot'
);

select * from finish();
rollback;
