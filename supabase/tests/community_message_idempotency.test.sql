-- ============================================================
-- Community chat — sender-scoped idempotency
--
-- Migration under test: 20261025120000_community_message_idempotency.sql
--
-- The offline outbox retries a send when the response was lost. Two sends of
-- the same text are legitimate ("ok", "ok"), so the only safe key is the
-- client-generated nonce — unique per SENDER:
--
--   1. the column exists and is nullable (older clients / server writers);
--   2. the unique index exists and is partial (NULLs do not collide);
--   3. a retry with the same (user_id, client_nonce) is rejected with 23505,
--      which the API turns into "return the original row";
--   4. the same nonce from another sender inserts (nonces are not global);
--   5. two NULL nonces from the same sender both insert (no accidental
--      serialization of normal messages);
--   6. a different nonce from the same sender inserts.
-- ============================================================

select plan(7);

-- ─── Fixture ────────────────────────────────────────────────
delete from public.community_messages
where user_id in (
  '9e9e9e9e-0000-4000-8000-000000000001',
  '9e9e9e9e-0000-4000-8000-000000000002'
);
delete from public.communities
where id = '9e9e9e9e-0000-4000-8000-000000000010';
delete from public.users
where id in (
  '9e9e9e9e-0000-4000-8000-000000000001',
  '9e9e9e9e-0000-4000-8000-000000000002'
);

insert into public.users (id, name, email, password_hash) values
  ('9e9e9e9e-0000-4000-8000-000000000001', 'idempotency sender', 'sender@idempotency.test', 'x'),
  ('9e9e9e9e-0000-4000-8000-000000000002', 'idempotency other',  'other@idempotency.test',  'x');

insert into public.communities (id, name, type, reference_id) values
  ('9e9e9e9e-0000-4000-8000-000000000010', 'idempotency room', 'city',
   '9e9e9e9e-0000-4000-8000-0000000000aa');

-- ─── 1. Shape ───────────────────────────────────────────────
select ok(
  exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'community_messages'
       and column_name = 'client_nonce'
       and is_nullable = 'YES'
       and data_type = 'uuid'
  ),
  'community_messages.client_nonce exists as a nullable uuid'
);

select has_index(
  'public',
  'community_messages',
  'idx_community_messages_sender_nonce',
  'the idempotency lookup is backed by a unique index'
);

-- ─── 2. First write succeeds ────────────────────────────────
insert into public.community_messages (community_id, user_id, content, client_nonce)
values (
  '9e9e9e9e-0000-4000-8000-000000000010',
  '9e9e9e9e-0000-4000-8000-000000000001',
  'hello',
  '11111111-1111-4111-8111-111111111111'
);

select is(
  (select count(*)::int from public.community_messages
    where user_id = '9e9e9e9e-0000-4000-8000-000000000001'
      and client_nonce = '11111111-1111-4111-8111-111111111111'),
  1,
  'the first send is stored once'
);

-- ─── 3. A retry of the same logical send is rejected ────────
select throws_ok(
  $sql$
    insert into public.community_messages (community_id, user_id, content, client_nonce)
    values (
      '9e9e9e9e-0000-4000-8000-000000000010',
      '9e9e9e9e-0000-4000-8000-000000000001',
      'hello',
      '11111111-1111-4111-8111-111111111111'
    )
  $sql$,
  '23505',
  null,
  'a retry with the same sender + nonce collides instead of duplicating'
);

-- ─── 4. Nonces are sender-scoped, not global ────────────────
insert into public.community_messages (community_id, user_id, content, client_nonce)
values (
  '9e9e9e9e-0000-4000-8000-000000000010',
  '9e9e9e9e-0000-4000-8000-000000000002',
  'hello',
  '11111111-1111-4111-8111-111111111111'
);

select is(
  (select count(*)::int from public.community_messages
    where client_nonce = '11111111-1111-4111-8111-111111111111'),
  2,
  'two senders may use the same nonce value'
);

-- ─── 5. NULL nonces do not collide ──────────────────────────
insert into public.community_messages (community_id, user_id, content)
values
  ('9e9e9e9e-0000-4000-8000-000000000010', '9e9e9e9e-0000-4000-8000-000000000001', 'ok'),
  ('9e9e9e9e-0000-4000-8000-000000000010', '9e9e9e9e-0000-4000-8000-000000000001', 'ok');

select is(
  (select count(*)::int from public.community_messages
    where user_id = '9e9e9e9e-0000-4000-8000-000000000001'
      and client_nonce is null),
  2,
  'rows without a nonce are never treated as retries'
);

-- ─── 6. A different logical send inserts ────────────────────
insert into public.community_messages (community_id, user_id, content, client_nonce)
values (
  '9e9e9e9e-0000-4000-8000-000000000010',
  '9e9e9e9e-0000-4000-8000-000000000001',
  'hello',
  '22222222-2222-4222-8222-222222222222'
);

select is(
  (select count(*)::int from public.community_messages
    where user_id = '9e9e9e9e-0000-4000-8000-000000000001'
      and client_nonce is not null),
  2,
  'the same text with a new nonce is a new message'
);

-- ─── Cleanup ────────────────────────────────────────────────
select * from finish();
