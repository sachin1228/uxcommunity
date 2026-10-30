-- ============================================================
-- Moderation evidence survives account deletion
--
-- Migration under test: 20261030230000_preserve_moderation_evidence.sql
--
-- The report rows are evidence. Deleting a reporter must not delete them, and
-- deleting a moderated member must not fail because the append-only audit log
-- is referenced by a foreign key. This file proves the database half of that:
--
--   1. every report queue accepts a null reporter and its foreign key is
--      `on delete set null` (not cascade);
--   2. a `before delete on users` trigger detaches the reporter from every
--      queue in the same transaction;
--   3. the report id, timestamp, reason, details, target snapshot, status and
--      audit link survive; only the reporter link is removed;
--   4. queue views say "Deleted user" and never resolve the deleted account;
--   5. deleting the reported member, the moderator, or the reported community
--      does not remove the report or its snapshot;
--   6. resolving a report after its reporter is gone still works;
--   7. the audit log remains append-only and its historical account ids are
--      not rewritten by account deletion.
--
-- Runs inside a transaction and rolls everything back.
-- ============================================================

begin;
select plan(62);

-- ─── Fixture ────────────────────────────────────────────────
insert into public.users (id, name, email, password_hash) values
  ('7e7e7e7e-0000-4000-8000-000000000001', 'Reporter',  'reporter@evidence.test', 'x'),
  ('7e7e7e7e-0000-4000-8000-000000000002', 'Target',    'target@evidence.test',   'x'),
  ('7e7e7e7e-0000-4000-8000-000000000003', 'Moderator', 'moderator@evidence.test','x');

insert into public.communities (id, name, description, type, reference_id, is_active)
values (
  '7e7e7e7e-0000-4000-8000-000000000010',
  'Evidence community',
  'A community description captured as evidence.',
  'city',
  '7e7e7e7e-0000-4000-8000-000000000010',
  true
);

insert into public.interaction_reports (
  id, reporter_id, target_type, target_id, context_id, community_id,
  target_author_id, target_author_name, target_excerpt, context_title,
  reason, details, status, target_snapshot, created_at
) values
  (
    '7e7e7e7e-0000-4000-8000-000000000101',
    '7e7e7e7e-0000-4000-8000-000000000001', 'community',
    '7e7e7e7e-0000-4000-8000-000000000010', null,
    '7e7e7e7e-0000-4000-8000-000000000010',
    '7e7e7e7e-0000-4000-8000-000000000002', 'Target',
    'A community description captured as evidence.', 'Evidence community',
    'inappropriate', 'Report details for the community.',
    'pending',
    '{"name":"Evidence community","description":"A community description captured as evidence.","owner_name":"Target"}'::jsonb,
    '2026-01-02 03:04:05+00'
  ),
  (
    '7e7e7e7e-0000-4000-8000-000000000102',
    '7e7e7e7e-0000-4000-8000-000000000001', 'job',
    '7e7e7e7e-0000-4000-8000-000000000020', null, null,
    '7e7e7e7e-0000-4000-8000-000000000002', 'Target',
    'A job description captured as evidence.', 'Senior designer',
    'scam', 'Report details for the job.',
    'pending',
    '{"title":"Senior designer","company_name":"Acme","description":"A job description captured as evidence.","poster_name":"Target"}'::jsonb,
    '2026-01-02 03:04:06+00'
  ),
  (
    '7e7e7e7e-0000-4000-8000-000000000103',
    '7e7e7e7e-0000-4000-8000-000000000001', 'profile',
    '7e7e7e7e-0000-4000-8000-000000000002', '7e7e7e7e-0000-4000-8000-000000000002', null,
    '7e7e7e7e-0000-4000-8000-000000000002', 'Target',
    'Member profile', 'Profile of Target',
    'harassment', 'Report details for the profile.',
    'pending', '{}'::jsonb,
    '2026-01-02 03:04:07+00'
  ),
  (
    '7e7e7e7e-0000-4000-8000-000000000104',
    '7e7e7e7e-0000-4000-8000-000000000001', 'thread_comment',
    '7e7e7e7e-0000-4000-8000-000000000030', '7e7e7e7e-0000-4000-8000-000000000031',
    '7e7e7e7e-0000-4000-8000-000000000010',
    '7e7e7e7e-0000-4000-8000-000000000002', 'Target',
    'A comment captured as evidence.', 'A thread title',
    'spam', 'Report details for the comment.',
    'pending', '{}'::jsonb,
    '2026-01-02 03:04:08+00'
  ),
  (
    '7e7e7e7e-0000-4000-8000-000000000105',
    '7e7e7e7e-0000-4000-8000-000000000001', 'community_message',
    '7e7e7e7e-0000-4000-8000-000000000040', '7e7e7e7e-0000-4000-8000-000000000010',
    '7e7e7e7e-0000-4000-8000-000000000010',
    '7e7e7e7e-0000-4000-8000-000000000002', 'Target',
    'A chat message captured as evidence.', 'Evidence community',
    'hate', 'Report details for the chat message.',
    'pending', '{}'::jsonb,
    '2026-01-02 03:04:09+00'
  );

insert into public.content_reports (
  id, reporter_id, content_type, content_id, community_id, content_author_id,
  content_title, reason, details, status, created_at
) values (
  '7e7e7e7e-0000-4000-8000-000000000201',
  '7e7e7e7e-0000-4000-8000-000000000001', 'thread',
  '7e7e7e7e-0000-4000-8000-000000000050',
  '7e7e7e7e-0000-4000-8000-000000000010',
  '7e7e7e7e-0000-4000-8000-000000000002',
  'A reported post', 'spam', 'Post report details.', 'pending',
  '2026-01-02 03:05:00+00'
);

insert into public.dm_reports (
  id, reporter_id, reported_user_id, reason, details, message_snapshot,
  status, created_at
) values (
  '7e7e7e7e-0000-4000-8000-000000000301',
  '7e7e7e7e-0000-4000-8000-000000000001',
  '7e7e7e7e-0000-4000-8000-000000000002',
  'harassment', 'DM report details.',
  '[{"id":"7e7e7e7e-0000-4000-8000-000000000060","user_id":"7e7e7e7e-0000-4000-8000-000000000002","author_name":"Target","content":"Evidence message","image_url":null,"created_at":"2026-01-02T03:00:00Z"}]'::jsonb,
  'pending', '2026-01-02 03:06:00+00'
);

insert into public.moderation_audit_log (
  id, moderator_id, moderator_label, moderator_sid, action, target_type,
  target_id, report_id, subject_user_id, previous_state, new_state, reason,
  created_at
) values (
  '7e7e7e7e-0000-4000-8000-000000000401',
  '7e7e7e7e-0000-4000-8000-000000000003', 'Moderator', 'admin-session-1',
  'warn_user', 'community', '7e7e7e7e-0000-4000-8000-000000000010',
  '7e7e7e7e-0000-4000-8000-000000000101',
  '7e7e7e7e-0000-4000-8000-000000000002',
  '{"warning_issued":false}'::jsonb, '{"warning_issued":true}'::jsonb,
  'A warning before deletion.',
  '2026-01-02 03:07:00+00'
);

-- ─── 1. Schema: reporter references are nullable and non-cascading ───
select ok(
  (select not attnotnull from pg_attribute
   where attrelid = 'public.interaction_reports'::regclass and attname = 'reporter_id'),
  'interaction_reports.reporter_id is nullable'
);
select ok(
  (select not attnotnull from pg_attribute
   where attrelid = 'public.content_reports'::regclass and attname = 'reporter_id'),
  'content_reports.reporter_id is nullable'
);
select ok(
  (select not attnotnull from pg_attribute
   where attrelid = 'public.dm_reports'::regclass and attname = 'reporter_id'),
  'dm_reports.reporter_id is nullable'
);

select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'interaction_reports'
      and column_name = 'reporter_deleted_at'
  ),
  'interaction_reports records when the reporter account was deleted'
);
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'content_reports'
      and column_name = 'reporter_deleted_at'
  ),
  'content_reports records when the reporter account was deleted'
);
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'dm_reports'
      and column_name = 'reporter_deleted_at'
  ),
  'dm_reports records when the reporter account was deleted'
);

select ok(
  (select pg_get_constraintdef(oid) like '%ON DELETE SET NULL%'
   from pg_constraint where conname = 'interaction_reports_reporter_id_fkey'),
  'interaction_reports reporter FK sets null instead of cascading'
);
select ok(
  (select pg_get_constraintdef(oid) like '%ON DELETE SET NULL%'
   from pg_constraint where conname = 'content_reports_reporter_id_fkey'),
  'content_reports reporter FK sets null instead of cascading'
);
select ok(
  (select pg_get_constraintdef(oid) like '%ON DELETE SET NULL%'
   from pg_constraint where conname = 'dm_reports_reporter_id_fkey'),
  'dm_reports reporter FK sets null instead of cascading'
);

select ok(
  not exists (
    select 1 from pg_constraint
    where conname in (
      'moderation_audit_log_moderator_id_fkey',
      'moderation_audit_log_subject_user_id_fkey',
      'moderation_audit_log_report_id_fkey'
    )
  ),
  'audit historical ids are not foreign keys that would rewrite an append-only row'
);

select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.users'::regclass
      and tgname = 'trg_anonymize_deleted_user_reports'
      and tgfoid = 'public.anonymize_deleted_user_reports()'::regprocedure
  ),
  'the account-deletion trigger is installed on users'
);
select ok(
  (select pg_get_triggerdef(oid) like '%BEFORE DELETE%'
   from pg_trigger where tgname = 'trg_anonymize_deleted_user_reports'),
  'the anonymization trigger runs BEFORE DELETE, in the deletion transaction'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.interaction_reports'::regclass),
  'interaction_reports still has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.content_reports'::regclass),
  'content_reports still has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.dm_reports'::regclass),
  'dm_reports still has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.moderation_audit_log'::regclass),
  'moderation_audit_log still has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.interaction_report_queue', 'SELECT')
  and not has_table_privilege('authenticated', 'public.interaction_report_queue', 'SELECT'),
  'the interaction queue is still service-role only'
);
select ok(
  not has_table_privilege('anon', 'public.dm_report_queue', 'SELECT')
  and not has_table_privilege('authenticated', 'public.dm_report_queue', 'SELECT'),
  'the DM queue is still service-role only'
);
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'interaction_reports_pending_unique')
  and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'content_reports_pending_unique')
  and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'dm_reports_pending_unique'),
  'duplicate-open-report protection indexes are unchanged'
);

-- ─── 2. Delete the reporter ─────────────────────────────────
select is(
  (select count(*)::integer from public.interaction_reports
   where reporter_id = '7e7e7e7e-0000-4000-8000-000000000001'),
  5,
  'five interaction reports exist before deletion'
);
select is(
  (select count(*)::integer from public.content_reports
   where reporter_id = '7e7e7e7e-0000-4000-8000-000000000001'),
  1,
  'one post report exists before deletion'
);
select is(
  (select count(*)::integer from public.dm_reports
   where reporter_id = '7e7e7e7e-0000-4000-8000-000000000001'),
  1,
  'one DM report exists before deletion'
);

delete from public.users where id = '7e7e7e7e-0000-4000-8000-000000000001';

select ok(
  not exists (select 1 from public.users where id = '7e7e7e7e-0000-4000-8000-000000000001'),
  'the reporter account is gone'
);
select is(
  (select count(*)::integer from public.interaction_reports
   where id in (
     '7e7e7e7e-0000-4000-8000-000000000101',
     '7e7e7e7e-0000-4000-8000-000000000102',
     '7e7e7e7e-0000-4000-8000-000000000103',
     '7e7e7e7e-0000-4000-8000-000000000104',
     '7e7e7e7e-0000-4000-8000-000000000105'
   )),
  5,
  'all five interaction reports survive the reporter deletion'
);
select is(
  (select count(*)::integer from public.content_reports
   where id = '7e7e7e7e-0000-4000-8000-000000000201'),
  1,
  'the post report survives the reporter deletion'
);
select is(
  (select count(*)::integer from public.dm_reports
   where id = '7e7e7e7e-0000-4000-8000-000000000301'),
  1,
  'the DM report survives the reporter deletion'
);

select is(
  (select count(*)::integer from public.interaction_reports
   where id in (
     '7e7e7e7e-0000-4000-8000-000000000101',
     '7e7e7e7e-0000-4000-8000-000000000102',
     '7e7e7e7e-0000-4000-8000-000000000103',
     '7e7e7e7e-0000-4000-8000-000000000104',
     '7e7e7e7e-0000-4000-8000-000000000105'
   ) and reporter_id is null),
  5,
  'every interaction report has its reporter link removed'
);
select is(
  (select count(*)::integer from public.content_reports
   where id = '7e7e7e7e-0000-4000-8000-000000000201' and reporter_id is null),
  1,
  'the post report has its reporter link removed'
);
select is(
  (select count(*)::integer from public.dm_reports
   where id = '7e7e7e7e-0000-4000-8000-000000000301' and reporter_id is null),
  1,
  'the DM report has its reporter link removed'
);
select is(
  (select count(*)::integer from public.interaction_reports
   where id in (
     '7e7e7e7e-0000-4000-8000-000000000101',
     '7e7e7e7e-0000-4000-8000-000000000102',
     '7e7e7e7e-0000-4000-8000-000000000103',
     '7e7e7e7e-0000-4000-8000-000000000104',
     '7e7e7e7e-0000-4000-8000-000000000105'
   ) and reporter_deleted_at is not null),
  5,
  'every interaction report records when the reporter was anonymized'
);
select is(
  (select reporter_deleted_at from public.content_reports
   where id = '7e7e7e7e-0000-4000-8000-000000000201') is not null,
  true,
  'the post report records when the reporter was anonymized'
);
select is(
  (select reporter_deleted_at from public.dm_reports
   where id = '7e7e7e7e-0000-4000-8000-000000000301') is not null,
  true,
  'the DM report records when the reporter was anonymized'
);

select is(
  (select created_at from public.interaction_reports
   where id = '7e7e7e7e-0000-4000-8000-000000000101'),
  '2026-01-02 03:04:05+00'::timestamptz,
  'the report timestamp is preserved'
);
select is(
  (select reason from public.interaction_reports
   where id = '7e7e7e7e-0000-4000-8000-000000000101'),
  'inappropriate',
  'the report reason is preserved'
);
select is(
  (select details from public.interaction_reports
   where id = '7e7e7e7e-0000-4000-8000-000000000101'),
  'Report details for the community.',
  'the reporter details are preserved'
);
select is(
  (select target_snapshot->>'name' from public.interaction_reports
   where id = '7e7e7e7e-0000-4000-8000-000000000101'),
  'Evidence community',
  'the community evidence snapshot is preserved'
);
select is(
  (select target_snapshot->>'description' from public.interaction_reports
   where id = '7e7e7e7e-0000-4000-8000-000000000102'),
  'A job description captured as evidence.',
  'the job evidence snapshot is preserved'
);
select is(
  (select status from public.interaction_reports
   where id = '7e7e7e7e-0000-4000-8000-000000000101'),
  'pending',
  'the report status is preserved'
);

-- ─── 3. Views never resolve the deleted reporter ────────────
select is(
  (select reporter_name from public.interaction_report_queue
   where id = '7e7e7e7e-0000-4000-8000-000000000101'),
  'Deleted user',
  'the interaction queue displays Deleted user'
);
select is(
  (select reporter_id from public.interaction_report_queue
   where id = '7e7e7e7e-0000-4000-8000-000000000101'),
  null::uuid,
  'the interaction queue exposes no deleted reporter id'
);
select is(
  (select reporter_name from public.dm_report_queue
   where id = '7e7e7e7e-0000-4000-8000-000000000301'),
  'Deleted user',
  'the DM queue displays Deleted user'
);
select is(
  (select reporter_names from public.report_groups
   where content_type = 'thread' and content_id = '7e7e7e7e-0000-4000-8000-000000000050'),
  array['Deleted user']::text[],
  'the post queue displays Deleted user instead of dropping the reporter'
);

-- ─── 4. Audit survives, and stays append-only ───────────────
select is(
  (select count(*)::integer from public.moderation_audit_log
   where id = '7e7e7e7e-0000-4000-8000-000000000401'),
  1,
  'the audit row survives the reporter deletion'
);
select is(
  (select report_id from public.moderation_audit_log
   where id = '7e7e7e7e-0000-4000-8000-000000000401'),
  '7e7e7e7e-0000-4000-8000-000000000101'::uuid,
  'the audit row still links to its preserved report'
);
select is(
  (select moderator_id from public.moderation_audit_log
   where id = '7e7e7e7e-0000-4000-8000-000000000401'),
  '7e7e7e7e-0000-4000-8000-000000000003'::uuid,
  'the moderator attribution is not rewritten by reporter deletion'
);
select is(
  (select moderator_label from public.moderation_audit_log
   where id = '7e7e7e7e-0000-4000-8000-000000000401'),
  'Moderator',
  'the moderator label is preserved'
);
select throws_ok(
  $$update public.moderation_audit_log set reason = 'tampered'
    where id = '7e7e7e7e-0000-4000-8000-000000000401'$$,
  'P0001',
  null,
  'the audit log still rejects updates after the migration'
);
select throws_ok(
  $$delete from public.moderation_audit_log
    where id = '7e7e7e7e-0000-4000-8000-000000000401'$$,
  'P0001',
  null,
  'the audit log still rejects deletes after the migration'
);

-- ─── 5. Resolution after reporter deletion ──────────────────
update public.interaction_reports
set status = 'dismissed', resolved_at = now(), resolution_note = 'Reviewed after deletion'
where id = '7e7e7e7e-0000-4000-8000-000000000101';

select is(
  (select status from public.interaction_reports
   where id = '7e7e7e7e-0000-4000-8000-000000000101'),
  'dismissed',
  'a report can still be resolved after its reporter is deleted'
);

insert into public.moderation_audit_log (
  id, moderator_id, moderator_label, moderator_sid, action, target_type,
  target_id, report_id, subject_user_id, previous_state, new_state, reason
) values (
  '7e7e7e7e-0000-4000-8000-000000000402',
  '7e7e7e7e-0000-4000-8000-000000000003', 'Moderator', 'admin-session-1',
  'dismiss_report', 'community', '7e7e7e7e-0000-4000-8000-000000000010',
  '7e7e7e7e-0000-4000-8000-000000000101',
  '7e7e7e7e-0000-4000-8000-000000000002',
  '{"report_status":"pending"}'::jsonb, '{"report_status":"dismissed"}'::jsonb,
  'Dismissed after reporter deletion.'
);

select is(
  (select count(*)::integer from public.moderation_audit_log
   where report_id = '7e7e7e7e-0000-4000-8000-000000000101'),
  2,
  'a new audit row can still be written for the preserved report'
);

-- A future retention purge must be able to remove old evidence without the
-- append-only audit table attempting an update. Use a throwaway report and
-- audit row: the audit row keeps its historical report id after the report is
-- gone, and no trigger blocks the purge.
insert into public.interaction_reports (
  id, reporter_id, target_type, target_id, reason, status
) values (
  '7e7e7e7e-0000-4000-8000-000000000106', null, 'profile',
  '7e7e7e7e-0000-4000-8000-000000000077', 'other', 'dismissed'
);
insert into public.moderation_audit_log (
  id, moderator_id, moderator_label, moderator_sid, action, target_type,
  target_id, report_id, subject_user_id, previous_state, new_state, reason
) values (
  '7e7e7e7e-0000-4000-8000-000000000403', null, 'Platform admin',
  'admin-session-1', 'dismiss_report', 'profile',
  '7e7e7e7e-0000-4000-8000-000000000077',
  '7e7e7e7e-0000-4000-8000-000000000106', null,
  '{}'::jsonb, '{}'::jsonb, 'Retention purge test.'
);

delete from public.interaction_reports
 where id = '7e7e7e7e-0000-4000-8000-000000000106';

select is(
  (select count(*)::integer from public.moderation_audit_log
   where id = '7e7e7e7e-0000-4000-8000-000000000403'),
  1,
  'the audit row survives an evidence-retention purge'
);
select is(
  (select report_id from public.moderation_audit_log
   where id = '7e7e7e7e-0000-4000-8000-000000000403'),
  '7e7e7e7e-0000-4000-8000-000000000106'::uuid,
  'the audit row keeps the historical report id after the report is gone'
);

-- ─── 6. Target, moderator and community deletion ────────────
delete from public.users where id = '7e7e7e7e-0000-4000-8000-000000000002';

select is(
  (select count(*)::integer from public.interaction_reports
   where id in (
     '7e7e7e7e-0000-4000-8000-000000000101',
     '7e7e7e7e-0000-4000-8000-000000000102',
     '7e7e7e7e-0000-4000-8000-000000000103',
     '7e7e7e7e-0000-4000-8000-000000000104',
     '7e7e7e7e-0000-4000-8000-000000000105'
   )),
  5,
  'reports survive deletion of the reported member'
);
select is(
  (select count(*)::integer from public.interaction_reports
   where id in (
     '7e7e7e7e-0000-4000-8000-000000000101',
     '7e7e7e7e-0000-4000-8000-000000000102',
     '7e7e7e7e-0000-4000-8000-000000000103',
     '7e7e7e7e-0000-4000-8000-000000000104',
     '7e7e7e7e-0000-4000-8000-000000000105'
   ) and target_author_id is null),
  5,
  'each report loses only the live target-author link'
);
select is(
  (select target_author_name from public.interaction_reports
   where id = '7e7e7e7e-0000-4000-8000-000000000101'),
  'Target',
  'the target display-name snapshot survives member deletion'
);
select is(
  (select count(*)::integer from public.moderation_audit_log
   where subject_user_id = '7e7e7e7e-0000-4000-8000-000000000002'),
  2,
  'audit history keeps its historical subject id without being rewritten'
);

delete from public.users where id = '7e7e7e7e-0000-4000-8000-000000000003';

select is(
  (select count(*)::integer from public.moderation_audit_log
   where moderator_id = '7e7e7e7e-0000-4000-8000-000000000003'),
  2,
  'audit history keeps its historical moderator id'
);
select is(
  (select moderator_label from public.moderation_audit_log
   where id = '7e7e7e7e-0000-4000-8000-000000000401'),
  'Moderator',
  'the moderator label survives moderator deletion'
);

delete from public.communities where id = '7e7e7e7e-0000-4000-8000-000000000010';

select is(
  (select count(*)::integer from public.interaction_reports
   where id = '7e7e7e7e-0000-4000-8000-000000000101'),
  1,
  'the community report survives deletion of the reported community'
);
select is(
  (select community_id from public.interaction_reports
   where id = '7e7e7e7e-0000-4000-8000-000000000101'),
  null::uuid,
  'only the live community link is nulled'
);
select is(
  (select target_snapshot->>'description' from public.interaction_reports
   where id = '7e7e7e7e-0000-4000-8000-000000000101'),
  'A community description captured as evidence.',
  'the community evidence snapshot survives community deletion'
);
select is(
  (select target_id from public.moderation_audit_log
   where id = '7e7e7e7e-0000-4000-8000-000000000401'),
  '7e7e7e7e-0000-4000-8000-000000000010'::uuid,
  'the audit target id remains available after community deletion'
);

select * from finish();
rollback;
