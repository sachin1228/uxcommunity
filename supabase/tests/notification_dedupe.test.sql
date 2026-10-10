-- ============================================================
-- M-4 — Notification deduplication is enforced by the database
--
-- Migration under test: 20260928140000_notification_dedupe.sql
--
-- M-4 was a check-then-insert race. createNotification() ran
--
--     SELECT ... WHERE user_id = ? AND entity_type = ? AND entity_id = ?
--                AND read_at IS NULL
--     -- no row -> INSERT,  row -> UPDATE (aggregate)
--
-- Two concurrent callers (two people commenting / liking / RSVPing to the same
-- recipient's content at once, each in its own deferred after()) could both see
-- "no row" and both INSERT, leaving two unread rows and a double-counted badge.
--
-- This file proves the race and the fix:
--
--   1. control — the old SELECT-then-INSERT pattern, run by two overlapping
--      sessions against an unindexed copy of the row, commits TWO rows;
--   2. the real table now has a partial UNIQUE index on the logical identity
--      (user_id, entity_type, entity_id) WHERE read_at IS NULL, so a second
--      unread row for the same key is rejected;
--   3. create_notification() is the atomic path: a repeat event aggregates into
--      the existing row (inserted = false) and 20 concurrent calls still leave
--      exactly one row, with every increment preserved;
--   4. distinct logical notifications (different entity, recipient or
--      entity_type) still get their own rows;
--   5. a notification that has been read is no longer the same identity, so a
--      later event inserts a fresh row.
--
-- The concurrency assertions need committed fixtures and a second connection,
-- neither of which works inside a rolled-back transaction, so — like
-- member_count_scale.test.sql — this file COMMITS its fixture and cleans up
-- after itself (and clears its own leftovers first, in case an earlier run
-- failed before cleanup). The two-session rounds run through psql \! and need
-- the PGHOST/PGDATABASE/PGUSER this harness exports.
-- ============================================================

create extension if not exists pgtap with schema extensions;
select plan(29);

-- ─── Fixture ────────────────────────────────────────────────
-- Recipients and actors the calls name, and the entity ids that stand in for
-- the thread/resource/event a notification is about (entity_id has no FK, so a
-- bare uuid is enough). Cleanup first so a failed earlier run cannot leak rows
-- into this one.
delete from public.notifications
where user_id in (
  '4d4d4d4d-0000-4000-8000-000000000001',
  '4d4d4d4d-0000-4000-8000-000000000004'
);
delete from public.users where email like '%@notification-dedupe.test';
drop schema if exists m4_legacy cascade;

insert into public.users (id, name, email, password_hash) values
  ('4d4d4d4d-0000-4000-8000-000000000001', 'M-4 recipient', 'recipient@notification-dedupe.test', 'x'),
  ('4d4d4d4d-0000-4000-8000-000000000002', 'M-4 actor a',   'actor-a@notification-dedupe.test',   'x'),
  ('4d4d4d4d-0000-4000-8000-000000000003', 'M-4 actor b',   'actor-b@notification-dedupe.test',   'x'),
  ('4d4d4d4d-0000-4000-8000-000000000004', 'M-4 recipient b', 'recipient-b@notification-dedupe.test', 'x');

-- ─── 1. The uniqueness that closes the race ─────────────────
select has_index('public', 'notifications', 'idx_notifications_user_entity_unread',
  'the dedupe lookup is backed by an index');

select ok(
  (select i.indisunique
   from pg_index i
   join pg_class c on c.oid = i.indexrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'idx_notifications_user_entity_unread'),
  'the dedupe index is UNIQUE, so the identity is a database fact'
);

select ok(
  (select pg_get_expr(i.indpred, i.indrelid) like '%read_at IS NULL%'
   from pg_index i
   join pg_class c on c.oid = i.indexrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'idx_notifications_user_entity_unread'),
  'the dedupe index only restricts unread rows, so a read notification can be re-created'
);

select has_function('public', 'create_notification',
  array['uuid', 'uuid', 'uuid', 'text', 'text', 'uuid', 'text', 'text', 'text', 'jsonb']);

select ok(
  not has_function_privilege('anon',
    'public.create_notification(uuid,uuid,uuid,text,text,uuid,text,text,text,jsonb)', 'execute'),
  'anon cannot execute the notification RPC'
);

select ok(
  not has_function_privilege('authenticated',
    'public.create_notification(uuid,uuid,uuid,text,text,uuid,text,text,text,jsonb)', 'execute'),
  'authenticated cannot execute the notification RPC'
);

select ok(
  has_function_privilege('service_role',
    'public.create_notification(uuid,uuid,uuid,text,text,uuid,text,text,text,jsonb)', 'execute'),
  'service_role can execute the notification RPC'
);

-- ─── 2. Control: the pre-M-4 pattern really duplicates ──────
-- An unindexed copy of just the columns the old lookup used. Each session runs
-- the OLD two-step under the same row: SELECT the unread row, pause, INSERT.
-- The pause puts both SELECTs before either INSERT — exactly the window two
-- in-flight requests open — and with no unique index both inserts commit.
create schema m4_legacy;
create table m4_legacy.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  entity_type text not null,
  entity_id   uuid not null,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

\! bash -c "psql -q -o /dev/null -c \"begin; select count(*) from m4_legacy.notifications where user_id = '4d4d4d4d-0000-4000-8000-000000000001' and entity_type = 'thread' and entity_id = '4d4d4d4d-0000-4000-8000-000000000201' and read_at is null; select pg_sleep(0.6); insert into m4_legacy.notifications (user_id, entity_type, entity_id) values ('4d4d4d4d-0000-4000-8000-000000000001', 'thread', '4d4d4d4d-0000-4000-8000-000000000201'); commit;\" & psql -q -o /dev/null -c \"begin; select count(*) from m4_legacy.notifications where user_id = '4d4d4d4d-0000-4000-8000-000000000001' and entity_type = 'thread' and entity_id = '4d4d4d4d-0000-4000-8000-000000000201' and read_at is null; select pg_sleep(0.6); insert into m4_legacy.notifications (user_id, entity_type, entity_id) values ('4d4d4d4d-0000-4000-8000-000000000001', 'thread', '4d4d4d4d-0000-4000-8000-000000000201'); commit;\" & wait"

select is(
  (select count(*)::integer from m4_legacy.notifications),
  2,
  'control: the old SELECT-then-INSERT pattern commits TWO rows for one logical notification'
);

-- ─── 3. The shared path: first call inserts, repeat aggregates ─
-- Every caller (comment / reply / like / RSVP) goes through this one RPC.
create temporary table m4_seq_first as
select * from public.create_notification(
  p_user_id      => '4d4d4d4d-0000-4000-8000-000000000001',
  p_actor_id     => '4d4d4d4d-0000-4000-8000-000000000002',
  p_community_id => null,
  p_type         => 'thread_comment',
  p_entity_type  => 'thread',
  p_entity_id    => '4d4d4d4d-0000-4000-8000-000000000101',
  p_title        => 'Alice commented on your thread',
  p_body         => 'Thread title',
  p_href         => '/dashboard/communities/c/threads/t'
);

select is((select inserted from m4_seq_first), true,
  'the first event for a key inserts a new notification');

select ok((select id from m4_seq_first) is not null,
  'the first call returns the inserted row');

select pg_sleep(0.01);

create temporary table m4_seq_second as
select * from public.create_notification(
  p_user_id      => '4d4d4d4d-0000-4000-8000-000000000001',
  p_actor_id     => '4d4d4d4d-0000-4000-8000-000000000003',
  p_community_id => null,
  p_type         => 'thread_like',
  p_entity_type  => 'thread',
  p_entity_id    => '4d4d4d4d-0000-4000-8000-000000000101',
  p_title        => 'Bob liked your thread',
  p_body         => 'Thread title',
  p_href         => '/dashboard/communities/c/threads/t'
);

select is((select inserted from m4_seq_second), false,
  'a repeat event on the same key aggregates instead of inserting');

select is((select id from m4_seq_second), (select id from m4_seq_first),
  'the repeat event updates the existing row, it does not create a new one');

select is(
  (select count(*)::integer from public.notifications
   where user_id = '4d4d4d4d-0000-4000-8000-000000000001'
     and entity_type = 'thread'
     and entity_id = '4d4d4d4d-0000-4000-8000-000000000101'),
  1,
  'exactly one unread row exists after two events on the same key'
);

select is(
  (select metadata ->> 'count' from public.notifications
   where user_id = '4d4d4d4d-0000-4000-8000-000000000001'
     and entity_type = 'thread'
     and entity_id = '4d4d4d4d-0000-4000-8000-000000000101'),
  '2',
  'metadata.count records both events on the single row'
);

select ok(
  (select type = 'thread_like'
          and actor_id = '4d4d4d4d-0000-4000-8000-000000000003'
          and title = 'Bob liked your thread'
   from public.notifications
   where user_id = '4d4d4d4d-0000-4000-8000-000000000001'
     and entity_type = 'thread'
     and entity_id = '4d4d4d4d-0000-4000-8000-000000000101'),
  'the newest event''s actor, type and title win on the aggregated row'
);

select ok(
  (select m4_seq_second.created_at > m4_seq_first.created_at
   from m4_seq_second, m4_seq_first),
  'the aggregated notification is bumped to the newest event''s time'
);

select throws_ok(
  $$insert into public.notifications (user_id, type, entity_type, entity_id, title, href)
    values ('4d4d4d4d-0000-4000-8000-000000000001', 'thread_comment', 'thread',
            '4d4d4d4d-0000-4000-8000-000000000101', 'duplicate', '/x')$$,
  '23505',
  null,
  'a second unread row for the same key is rejected by the unique index'
);

-- ─── 4. Concurrency: 20 overlapping calls, still one row ────
-- Twenty separate connections fire the RPC for the same key at once. One
-- inserts; the nineteen that conflict aggregate into it. If any increment were
-- lost, the count would come back under 20.
\! bash -c "for i in \$(seq 1 20); do psql -q -o /dev/null -c \"select public.create_notification(p_user_id => '4d4d4d4d-0000-4000-8000-000000000001', p_actor_id => '4d4d4d4d-0000-4000-8000-000000000002', p_community_id => null, p_type => 'thread_like', p_entity_type => 'thread', p_entity_id => '4d4d4d4d-0000-4000-8000-000000000102', p_title => 'Race', p_body => null, p_href => '/x');\" & done; wait"

select is(
  (select count(*)::integer from public.notifications
   where user_id = '4d4d4d4d-0000-4000-8000-000000000001'
     and entity_type = 'thread'
     and entity_id = '4d4d4d4d-0000-4000-8000-000000000102'),
  1,
  'twenty concurrent calls for the same key produce exactly ONE notification'
);

select is(
  (select metadata ->> 'count' from public.notifications
   where user_id = '4d4d4d4d-0000-4000-8000-000000000001'
     and entity_type = 'thread'
     and entity_id = '4d4d4d4d-0000-4000-8000-000000000102'),
  '20',
  'every concurrent call was counted on the single row (no lost increments)'
);

-- ─── 5. Distinct logical notifications stay separate ────────
select * from public.create_notification(
  p_user_id      => '4d4d4d4d-0000-4000-8000-000000000001',
  p_actor_id     => '4d4d4d4d-0000-4000-8000-000000000002',
  p_community_id => null,
  p_type         => 'thread_comment',
  p_entity_type  => 'thread',
  p_entity_id    => '4d4d4d4d-0000-4000-8000-000000000103',
  p_title        => 'Other thread',
  p_body         => null,
  p_href         => '/x'
);

select is(
  (select count(*)::integer from public.notifications
   where user_id = '4d4d4d4d-0000-4000-8000-000000000001'
     and entity_type = 'thread'
     and entity_id = '4d4d4d4d-0000-4000-8000-000000000103'),
  1,
  'a different entity id is a different notification'
);

select * from public.create_notification(
  p_user_id      => '4d4d4d4d-0000-4000-8000-000000000004',
  p_actor_id     => '4d4d4d4d-0000-4000-8000-000000000002',
  p_community_id => null,
  p_type         => 'thread_comment',
  p_entity_type  => 'thread',
  p_entity_id    => '4d4d4d4d-0000-4000-8000-000000000101',
  p_title        => 'Same entity, other recipient',
  p_body         => null,
  p_href         => '/x'
);

select is(
  (select count(*)::integer from public.notifications
   where user_id = '4d4d4d4d-0000-4000-8000-000000000004'
     and entity_type = 'thread'
     and entity_id = '4d4d4d4d-0000-4000-8000-000000000101'),
  1,
  'a different recipient gets their own notification for the same entity'
);

select * from public.create_notification(
  p_user_id      => '4d4d4d4d-0000-4000-8000-000000000001',
  p_actor_id     => '4d4d4d4d-0000-4000-8000-000000000003',
  p_community_id => null,
  p_type         => 'event_rsvp',
  p_entity_type  => 'event',
  p_entity_id    => '4d4d4d4d-0000-4000-8000-000000000101',
  p_title        => 'RSVPed',
  p_body         => null,
  p_href         => '/x'
);

select is(
  (select count(*)::integer from public.notifications
   where user_id = '4d4d4d4d-0000-4000-8000-000000000001'
     and entity_type = 'event'
     and entity_id = '4d4d4d4d-0000-4000-8000-000000000101'),
  1,
  'a different entity_type with the same id is a different notification'
);

-- ─── 6. A read notification is a new identity ───────────────
create temporary table m4_read_first as
select * from public.create_notification(
  p_user_id      => '4d4d4d4d-0000-4000-8000-000000000001',
  p_actor_id     => '4d4d4d4d-0000-4000-8000-000000000002',
  p_community_id => null,
  p_type         => 'resource_comment',
  p_entity_type  => 'resource',
  p_entity_id    => '4d4d4d4d-0000-4000-8000-000000000104',
  p_title        => 'Read me',
  p_body         => null,
  p_href         => '/x'
);

update public.notifications
set read_at = now()
where id = (select id from m4_read_first);

select pg_sleep(0.01);

create temporary table m4_read_second as
select * from public.create_notification(
  p_user_id      => '4d4d4d4d-0000-4000-8000-000000000001',
  p_actor_id     => '4d4d4d4d-0000-4000-8000-000000000003',
  p_community_id => null,
  p_type         => 'resource_comment',
  p_entity_type  => 'resource',
  p_entity_id    => '4d4d4d4d-0000-4000-8000-000000000104',
  p_title        => 'New event after read',
  p_body         => null,
  p_href         => '/x'
);

select is((select inserted from m4_read_second), true,
  'once a notification is read, a later event inserts a new one');

select is(
  (select count(*)::integer from public.notifications
   where user_id = '4d4d4d4d-0000-4000-8000-000000000001'
     and entity_type = 'resource'
     and entity_id = '4d4d4d4d-0000-4000-8000-000000000104'),
  2,
  'the read row and the new unread row both exist'
);

select ok(
  (select m4_read_second.id <> m4_read_first.id from m4_read_second, m4_read_first),
  'the post-read notification is a distinct row, not the read one'
);

-- ─── 7. The job-match type ──────────────────────────────────
-- 20261010140000_job_match_notifications.sql: two constraint rebuilds let the
-- jobs feature tell matching members a role was posted. The unread identity
-- holds for the new entity kind too — one row per member per job.
create temporary table m4_job_first as
select * from public.create_notification(
  p_user_id      => '4d4d4d4d-0000-4000-8000-000000000001',
  p_actor_id     => '4d4d4d4d-0000-4000-8000-000000000002',
  p_community_id => null,
  p_type         => 'job_match',
  p_entity_type  => 'job',
  p_entity_id    => '4d4d4d4d-0000-4000-8000-000000000301',
  p_title        => 'A new role matches your profile',
  p_body         => 'Senior Product Designer at Jobsco — All cities (Hybrid)',
  p_href         => '/dashboard/jobs/4d4d4d4d-0000-4000-8000-000000000301'
);

select is((select inserted from m4_job_first), true,
  'a job-match notification inserts with type ''job_match'' and entity ''job''');

select throws_ok(
  $$ insert into public.notifications (user_id, type, entity_type, entity_id, title, href)
     values ('4d4d4d4d-0000-4000-8000-000000000001', 'job_posted', 'job',
             '4d4d4d4d-0000-4000-8000-000000000302', 'Off-list type', '/') $$,
  '23514',
  null,
  'a type outside the constraint is still refused'
);

-- ─── 8. Cleanup ─────────────────────────────────────────────
delete from public.notifications
where user_id in (
  '4d4d4d4d-0000-4000-8000-000000000001',
  '4d4d4d4d-0000-4000-8000-000000000004'
);
delete from public.users where email like '%@notification-dedupe.test';
drop schema if exists m4_legacy cascade;

select is(
  (select count(*)::integer from public.users
   where email like '%@notification-dedupe.test'),
  0,
  'cleanup removed the fixture users and their notifications'
);

select ok(
  not exists (select 1 from pg_namespace where nspname = 'm4_legacy'),
  'cleanup removed the unindexed shadow table used for the control'
);

select * from finish();
