-- ============================================================
-- Direct messages: schema invariants + RPC behaviour.
--
-- Pins what the DM feature trusts from the database layer:
--   * the pair model (canonical order, one row per pair, no self-chat),
--   * last_message_at being maintained by the insert trigger,
--   * unread maths (per-side read markers, peer messages only),
--   * the message page's participant guard, ordering and embedded
--     sender/reaction/reply payloads,
--   * the privacy boundary (no client-role grants on the tables).
--
-- Fixtures: the harness seeds users Viewer (1111…), Author (2222…) and
-- Third (3333…). This file's own rows live in a `dec0de00-` UUID namespace
-- so full-suite runs cannot collide with other files' fixtures.
-- ============================================================
begin;
create extension if not exists pgtap with schema extensions;
select plan(19);

-- ─── The four RPCs exist ────────────────────────────────────
select has_function('public', 'get_or_create_dm_conversation',
  'get_or_create_dm_conversation exists');
select has_function('public', 'get_dm_conversations',
  'get_dm_conversations exists');
select has_function('public', 'get_dm_message_page',
  'get_dm_message_page exists');
select has_function('public', 'get_dm_unread_total',
  'get_dm_unread_total exists');

select has_index('public', 'dm_messages', 'idx_dm_messages_conversation_time',
  'message pages are served by the (conversation, created_at) index');

-- ─── Pair model ─────────────────────────────────────────────
-- 1. The canonical order is enforced, not just assumed.
select throws_ok(
  $$insert into public.dm_conversations (user_a, user_b)
    values ('22222222-2222-2222-2222-222222222222',
            '11111111-1111-1111-1111-111111111111')$$,
  '23514',
  'pair order check',
  'inserting the pair in reverse order is rejected'
);

insert into public.dm_conversations (id, user_a, user_b) values
  ('dec0de00-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111',
   '22222222-2222-2222-2222-222222222222'),
  ('dec0de00-0000-4000-8000-000000000002',
   '11111111-1111-1111-1111-111111111111',
   '33333333-3333-3333-3333-333333333333');

-- 2. …and a pair has exactly one row.
select throws_ok(
  $$insert into public.dm_conversations (user_a, user_b)
    values ('11111111-1111-1111-1111-111111111111',
            '22222222-2222-2222-2222-222222222222')$$,
  '23505',
  'pair unique',
  'a second conversation for the same pair is rejected'
);

-- 3. The create-or-get RPC normalizes argument order: both orders land on
--    the same row, whichever one creates it.
select is(
  (select id from public.get_or_create_dm_conversation(
     '33333333-3333-3333-3333-333333333333',
     '22222222-2222-2222-2222-222222222222')),
  (select id from public.get_or_create_dm_conversation(
     '22222222-2222-2222-2222-222222222222',
     '33333333-3333-3333-3333-333333333333')),
  'both argument orders resolve to the same conversation row'
);

-- 4. A self-conversation is refused outright.
select throws_ok(
  $$select * from public.get_or_create_dm_conversation(
      '11111111-1111-1111-1111-111111111111',
      '11111111-1111-1111-1111-111111111111')$$,
  '22023',
  'self conversation',
  'starting a conversation with yourself is rejected'
);

-- ─── Messages + the touch trigger ───────────────────────────
insert into public.dm_messages (id, conversation_id, user_id, content, created_at) values
  ('dec0de00-0000-4000-8000-000000000101', 'dec0de00-0000-4000-8000-000000000001',
   '22222222-2222-2222-2222-222222222222', 'hey there',       now() - interval '5 minutes'),
  ('dec0de00-0000-4000-8000-000000000102', 'dec0de00-0000-4000-8000-000000000001',
   '22222222-2222-2222-2222-222222222222', 'you around?',     now() - interval '4 minutes'),
  ('dec0de00-0000-4000-8000-000000000103', 'dec0de00-0000-4000-8000-000000000001',
   '11111111-1111-1111-1111-111111111111', 'yes',             now() - interval '3 minutes'),
  ('dec0de00-0000-4000-8000-000000000104', 'dec0de00-0000-4000-8000-000000000002',
   '33333333-3333-3333-3333-333333333333', 'hello viewer',    now() - interval '2 minutes');

select is(
  (select c.last_message_at = m.created_at
     from public.dm_conversations c, public.dm_messages m
    where c.id = 'dec0de00-0000-4000-8000-000000000001'
      and m.id = 'dec0de00-0000-4000-8000-000000000103'),
  true,
  'inserting a message stamps the conversation''s last_message_at'
);

-- ─── Unread maths ───────────────────────────────────────────
-- The badge counts CONVERSATIONS with unread peer messages (people who
-- messaged you), not messages: viewer has 3 unread messages but they sit in
-- two conversations (2 in conv 1, 1 in conv 2).
select is(
  public.get_dm_unread_total('11111111-1111-1111-1111-111111111111'),
  2,
  'the badge counts unread conversations, not messages'
);

-- The author only counts the viewer's reply, not their own messages.
select is(
  public.get_dm_unread_total('22222222-2222-2222-2222-222222222222'),
  1,
  'own messages never count towards the conversation total'
);

update public.dm_conversations
   set user_a_last_read_at = now()
 where id = 'dec0de00-0000-4000-8000-000000000001';

select is(
  public.get_dm_unread_total('11111111-1111-1111-1111-111111111111'),
  1,
  'marking conversation 1 read drops it from the count'
);

-- ─── Message page ───────────────────────────────────────────
select is(
  (select count(*)::integer
     from public.get_dm_message_page(
       'dec0de00-0000-4000-8000-000000000001',
       '11111111-1111-1111-1111-111111111111')),
  3,
  'the message page returns the conversation''s messages'
);

select is(
  (select r.id from public.get_dm_message_page(
     'dec0de00-0000-4000-8000-000000000001',
     '11111111-1111-1111-1111-111111111111') r
   limit 1),
  'dec0de00-0000-4000-8000-000000000103'::uuid,
  'the page is ordered newest first'
);

select is(
  (select r.users ->> 'name' from public.get_dm_message_page(
     'dec0de00-0000-4000-8000-000000000001',
     '11111111-1111-1111-1111-111111111111') r
   where r.id = 'dec0de00-0000-4000-8000-000000000101'),
  'Author',
  'each row embeds the sender''s name'
);

insert into public.dm_message_reactions (id, message_id, conversation_id, user_id, emoji)
values ('dec0de00-0000-4000-8000-000000000201',
        'dec0de00-0000-4000-8000-000000000102',
        'dec0de00-0000-4000-8000-000000000001',
        '11111111-1111-1111-1111-111111111111', '❤️');

select is(
  (select r.reactions -> 0 ->> 'emoji' from public.get_dm_message_page(
     'dec0de00-0000-4000-8000-000000000001',
     '11111111-1111-1111-1111-111111111111') r
   where r.id = 'dec0de00-0000-4000-8000-000000000102'),
  '❤️',
  'reactions come back grouped by emoji on the row that has them'
);

select is(
  (select count(*)::integer
     from public.get_dm_message_page(
       'dec0de00-0000-4000-8000-000000000001',
       '33333333-3333-3333-3333-333333333333')),
  0,
  'a non-participant gets an empty page'
);

-- ─── Privacy boundary ───────────────────────────────────────
select ok(
  not has_table_privilege('authenticated', 'public.dm_messages', 'SELECT'),
  'authenticated has no read grant on dm_messages'
);

select * from finish();
rollback;
