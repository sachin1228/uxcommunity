-- ============================================================
-- Report submission racing account deletion
--
-- Migration under test: 20261030230000_preserve_moderation_evidence.sql
--
-- Two real sessions overlap, because the consistency guarantee is the
-- combination of the foreign key and the `before delete` trigger:
--
--   race 1 — the report INSERT commits first, then the account DELETE waits
--            on the reporter's row lock and anonymizes the report;
--   race 2 — the account DELETE commits first, then the report INSERT fails
--            its foreign key instead of storing a dangling reporter.
--
-- Either outcome is valid. The invalid outcome is a report row whose
-- reporter_id still names a deleted account, or a half-anonymized report.
--
-- This file commits its small fixture because the second session must see it;
-- it cleans up at the start and end. It needs the PGHOST/PGDATABASE/PGUSER the
-- local harness exports, exactly like member_count_scale.test.sql.
-- ============================================================

select plan(6);

-- ─── Cleanup from an earlier failed run ─────────────────────
delete from public.interaction_reports
 where id in (
   '7f7f7f7f-0000-4000-8000-000000000101',
   '7f7f7f7f-0000-4000-8000-000000000102'
 );
delete from public.users
 where id in (
   '7f7f7f7f-0000-4000-8000-000000000001',
   '7f7f7f7f-0000-4000-8000-000000000002',
   '7f7f7f7f-0000-4000-8000-000000000003'
 );

insert into public.users (id, name, email, password_hash) values
  ('7f7f7f7f-0000-4000-8000-000000000001', 'Race reporter one', 'race-one@evidence.test', 'x'),
  ('7f7f7f7f-0000-4000-8000-000000000002', 'Race reporter two', 'race-two@evidence.test', 'x'),
  ('7f7f7f7f-0000-4000-8000-000000000003', 'Race target',       'race-target@evidence.test', 'x');

-- ─── Race 1: insert commits, delete waits then anonymizes ───
\! bash -c "psql -q -o /dev/null -c \"insert into public.interaction_reports (id, reporter_id, target_type, target_id, target_author_id, target_author_name, target_excerpt, reason, status) values ('7f7f7f7f-0000-4000-8000-000000000101', '7f7f7f7f-0000-4000-8000-000000000001', 'profile', '7f7f7f7f-0000-4000-8000-000000000003', '7f7f7f7f-0000-4000-8000-000000000003', 'Race target', 'Member profile', 'harassment', 'pending'); select pg_sleep(0.6);\" 2>/dev/null & psql -q -o /dev/null -c \"select pg_sleep(0.2); delete from public.users where id = '7f7f7f7f-0000-4000-8000-000000000001';\" 2>/dev/null & wait"

select ok(
  not exists (select 1 from public.users where id = '7f7f7f7f-0000-4000-8000-000000000001'),
  'race 1: the reporter account was deleted'
);
select is(
  (select count(*)::integer from public.interaction_reports
   where id = '7f7f7f7f-0000-4000-8000-000000000101'),
  1,
  'race 1: the report submitted before deletion is retained'
);
select is(
  (select reporter_id from public.interaction_reports
   where id = '7f7f7f7f-0000-4000-8000-000000000101'),
  null::uuid,
  'race 1: the retained report has no reporter link'
);
select is(
  (select reporter_deleted_at from public.interaction_reports
   where id = '7f7f7f7f-0000-4000-8000-000000000101') is not null,
  true,
  'race 1: the retained report is marked anonymized'
);

-- ─── Race 2: delete commits first, insert must fail ─────────
\! bash -c "psql -q -o /dev/null -c \"delete from public.users where id = '7f7f7f7f-0000-4000-8000-000000000002';\" 2>/dev/null & psql -q -o /dev/null -c \"select pg_sleep(0.2); insert into public.interaction_reports (id, reporter_id, target_type, target_id, target_author_id, target_author_name, target_excerpt, reason, status) values ('7f7f7f7f-0000-4000-8000-000000000102', '7f7f7f7f-0000-4000-8000-000000000002', 'profile', '7f7f7f7f-0000-4000-8000-000000000003', '7f7f7f7f-0000-4000-8000-000000000003', 'Race target', 'Member profile', 'harassment', 'pending');\" 2>/dev/null & wait"

select ok(
  not exists (select 1 from public.users where id = '7f7f7f7f-0000-4000-8000-000000000002'),
  'race 2: the reporter account was deleted'
);
select is(
  (select count(*)::integer from public.interaction_reports
   where id = '7f7f7f7f-0000-4000-8000-000000000102'),
  0,
  'race 2: no report can be stored against the deleted account'
);

-- ─── Cleanup ────────────────────────────────────────────────
delete from public.interaction_reports
 where id in (
   '7f7f7f7f-0000-4000-8000-000000000101',
   '7f7f7f7f-0000-4000-8000-000000000102'
 );
delete from public.users
 where id in (
   '7f7f7f7f-0000-4000-8000-000000000001',
   '7f7f7f7f-0000-4000-8000-000000000002',
   '7f7f7f7f-0000-4000-8000-000000000003'
 );

select * from finish();
