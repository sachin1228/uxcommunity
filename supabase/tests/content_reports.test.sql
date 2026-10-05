-- ============================================================
-- Content reports — the constraints the report flow relies on
--
-- Migrations under test: 20261005120000_content_reports.sql and
--                         20261005140000_report_review_and_undo.sql
--
-- The report API trusts the database for these things, so each is proven here:
--
--   1. `reason` and `content_type` only accept the values the modal offers —
--      a bad payload from an old client is rejected, not stored;
--   2. the partial UNIQUE index allows exactly ONE pending report per member
--      per post (a duplicate submission is a 23505 the API maps to 409), yet
--      still lets the member report the same post again once their earlier
--      report was resolved;
--   3. the notifications type check accepts the new `report_reviewed` and
--      `content_restored` types the workflow writes;
--   4. `content_removals` snapshots an admin takedown for undo, and
--      `report_groups` collapses every report on one post into a single queue
--      row (status precedence, counts, reasons, restore-ability).
--
-- Commit-free and self-cleaning: every fixture is deleted at the end.
-- ============================================================

create extension if not exists pgtap with schema extensions;
select plan(30);

-- ─── Fixture ────────────────────────────────────────────────
-- Clean up leftovers first, so a failed earlier run cannot leak rows in.
delete from public.content_reports
where reporter_id in (
  '5e5e5e5e-0000-4000-8000-000000000001',
  '5e5e5e5e-0000-4000-8000-000000000002'
);
delete from public.notifications
where user_id = '5e5e5e5e-0000-4000-8000-000000000001';
delete from public.users where email like '%@content-reports.test';

insert into public.users (id, name, email, password_hash) values
  ('5e5e5e5e-0000-4000-8000-000000000001', 'Report reporter', 'reporter@content-reports.test', 'x'),
  ('5e5e5e5e-0000-4000-8000-000000000002', 'Report author',   'author@content-reports.test',   'x');

-- ─── 1. The table and its pending uniqueness ────────────────
select has_index('public', 'content_reports', 'content_reports_pending_unique',
  'the duplicate-report lookup is backed by an index');

select ok(
  (select i.indisunique
   from pg_index i
   join pg_class c on c.oid = i.indexrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'content_reports_pending_unique'),
  'the duplicate-report index is UNIQUE'
);

select ok(
  (select pg_get_expr(i.indpred, i.indrelid) like '%pending%'
   from pg_index i
   join pg_class c on c.oid = i.indexrelid
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'content_reports_pending_unique'),
  'only pending reports count as the same open report'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.content_reports'::regclass),
  'content_reports has RLS enabled (reads/writes go through the service role)'
);

-- ─── 2. Reason and content-type constraints ─────────────────
select throws_ok(
  $$insert into public.content_reports
      (reporter_id, content_type, content_id, reason)
    values ('5e5e5e5e-0000-4000-8000-000000000001', 'thread',
            '5e5e5e5e-0000-4000-8000-000000000101', 'not_a_real_reason')$$,
  '23514',
  null,
  'an unknown reporting reason is rejected by the check constraint'
);

select throws_ok(
  $$insert into public.content_reports
      (reporter_id, content_type, content_id, reason)
    values ('5e5e5e5e-0000-4000-8000-000000000001', 'chat_message',
            '5e5e5e5e-0000-4000-8000-000000000101', 'spam')$$,
  '23514',
  null,
  'an unknown content type is rejected by the check constraint'
);

-- ─── 3. One open report per member per post ─────────────────
insert into public.content_reports
  (reporter_id, content_type, content_id, content_author_id, content_title, reason, details)
values
  ('5e5e5e5e-0000-4000-8000-000000000001', 'thread',
   '5e5e5e5e-0000-4000-8000-000000000101', '5e5e5e5e-0000-4000-8000-000000000002',
   'Reported thread', 'spam', 'Looks like an ad.');

select is(
  (select count(*)::integer from public.content_reports
   where reporter_id = '5e5e5e5e-0000-4000-8000-000000000001'
     and content_type = 'thread'
     and content_id = '5e5e5e5e-0000-4000-8000-000000000101'),
  1,
  'a valid report is stored'
);

select throws_ok(
  $$insert into public.content_reports
      (reporter_id, content_type, content_id, reason)
    values ('5e5e5e5e-0000-4000-8000-000000000001', 'thread',
            '5e5e5e5e-0000-4000-8000-000000000101', 'harassment')$$,
  '23505',
  null,
  'a second PENDING report from the same member for the same post is rejected'
);

update public.content_reports
set status = 'dismissed', resolved_at = now()
where reporter_id = '5e5e5e5e-0000-4000-8000-000000000001'
  and content_id = '5e5e5e5e-0000-4000-8000-000000000101';

insert into public.content_reports
  (reporter_id, content_type, content_id, reason)
values
  ('5e5e5e5e-0000-4000-8000-000000000001', 'thread',
   '5e5e5e5e-0000-4000-8000-000000000101', 'harassment');

select is(
  (select count(*)::integer from public.content_reports
   where reporter_id = '5e5e5e5e-0000-4000-8000-000000000001'
     and content_id = '5e5e5e5e-0000-4000-8000-000000000101'),
  2,
  'once the earlier report is resolved, the member can report the post again'
);

select is(
  (select count(*)::integer from public.content_reports
   where reporter_id = '5e5e5e5e-0000-4000-8000-000000000001'
     and content_id = '5e5e5e5e-0000-4000-8000-000000000101'
     and status = 'pending'),
  1,
  'exactly one report for the post is open at a time'
);

-- ─── 4. The reporter's thank-you type ───────────────────────
insert into public.notifications (user_id, type, entity_type, entity_id, title, href)
values ('5e5e5e5e-0000-4000-8000-000000000001', 'report_reviewed', 'thread',
        '5e5e5e5e-0000-4000-8000-000000000101', 'Thanks for reporting', '/dashboard/notifications');

select is(
  (select count(*)::integer from public.notifications
   where user_id = '5e5e5e5e-0000-4000-8000-000000000001'
     and type = 'report_reviewed'),
  1,
  'notifications accept the report_reviewed type'
);

select throws_ok(
  $$insert into public.notifications (user_id, type, entity_type, entity_id, title, href)
    values ('5e5e5e5e-0000-4000-8000-000000000001', 'not_a_type', 'thread',
            '5e5e5e5e-0000-4000-8000-000000000102', 'x', '/x')$$,
  '23514',
  null,
  'an unknown notification type is still rejected'
);

-- ─── 5. Undo snapshots (20261005140000) ───────────────────
select ok(
  to_regclass('public.content_removals') is not null,
  'content_removals exists for undo snapshots'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.content_removals'::regclass),
  'content_removals has RLS enabled'
);

select has_index('public', 'content_removals', 'idx_content_removals_active',
  'active removals are indexed by content');

insert into public.content_removals
  (content_type, content_id, community_id, content_author_id, content_title, snapshot, removed_by)
values
  ('thread', '5e5e5e5e-0000-4000-8000-000000000101', null,
   '5e5e5e5e-0000-4000-8000-000000000002', 'Reported thread',
   '{"version":1,"content":{"id":"5e5e5e5e-0000-4000-8000-000000000101"},"children":{},"event_chat_community_id":null}'::jsonb,
   '5e5e5e5e-0000-4000-8000-000000000001');

select is(
  (select count(*)::integer from public.content_removals
   where content_id = '5e5e5e5e-0000-4000-8000-000000000101'
     and undone_at is null),
  1,
  'a removal stays active until it is undone'
);

-- ─── 6. The grouped queue view ──────────────────────────────
select ok(
  to_regclass('public.report_groups') is not null,
  'the queue view exists'
);

select ok(
  not has_table_privilege('authenticated', 'public.report_groups', 'SELECT'),
  'the queue view is service-role only'
);

-- A second member reports the same post: the view must collapse both into one
-- row even though the underlying content no longer exists (the removal above
-- stands in for a deleted thread).
insert into public.content_reports
  (reporter_id, content_type, content_id, content_author_id, content_title, reason)
values
  ('5e5e5e5e-0000-4000-8000-000000000002', 'thread',
   '5e5e5e5e-0000-4000-8000-000000000101', '5e5e5e5e-0000-4000-8000-000000000002',
   'Reported thread', 'hate');

select is(
  (select status from public.report_groups
   where content_type = 'thread' and content_id = '5e5e5e5e-0000-4000-8000-000000000101'),
  'pending',
  'a group with any pending report reads as pending'
);

select is(
  (select report_count from public.report_groups
   where content_type = 'thread' and content_id = '5e5e5e5e-0000-4000-8000-000000000101'),
  3,
  'every report on the post is counted once'
);

select is(
  (select pending_count from public.report_groups
   where content_type = 'thread' and content_id = '5e5e5e5e-0000-4000-8000-000000000101'),
  2,
  'pending_count counts only the open reports'
);

select ok(
  (select reasons @> array['hate']::text[] from public.report_groups
   where content_type = 'thread' and content_id = '5e5e5e5e-0000-4000-8000-000000000101'),
  'the distinct reasons are collected on the group'
);

select is(
  (select array_length(reporter_ids, 1) from public.report_groups
   where content_type = 'thread' and content_id = '5e5e5e5e-0000-4000-8000-000000000101'),
  2,
  'each reporter appears once on the group'
);

select is(
  (select content_exists from public.report_groups
   where content_type = 'thread' and content_id = '5e5e5e5e-0000-4000-8000-000000000101'),
  false,
  'a group whose post is gone falls back to the report snapshot'
);

select is(
  (select can_restore from public.report_groups
   where content_type = 'thread' and content_id = '5e5e5e5e-0000-4000-8000-000000000101'),
  true,
  'an active removal makes the group restorable'
);

select is(
  (select author_name from public.report_groups
   where content_type = 'thread' and content_id = '5e5e5e5e-0000-4000-8000-000000000101'),
  'Report author',
  'the author name comes from the report snapshot when the post is gone'
);

update public.content_reports
set status = 'dismissed', resolved_at = now()
where content_id = '5e5e5e5e-0000-4000-8000-000000000101';

select is(
  (select status from public.report_groups
   where content_type = 'thread' and content_id = '5e5e5e5e-0000-4000-8000-000000000101'),
  'dismissed',
  'with no pending and no removed reports the group reads as dismissed'
);

update public.content_removals
set undone_at = now()
where content_id = '5e5e5e5e-0000-4000-8000-000000000101';

select is(
  (select can_restore from public.report_groups
   where content_type = 'thread' and content_id = '5e5e5e5e-0000-4000-8000-000000000101'),
  false,
  'an undone removal is no longer offered as a restore'
);

-- A distinct entity: the dedupe index allows only one unread notification
-- per (user, entity), and the fixture above already has one on the thread.
insert into public.notifications (user_id, type, entity_type, entity_id, title, href)
values ('5e5e5e5e-0000-4000-8000-000000000001', 'content_restored', 'thread',
        '5e5e5e5e-0000-4000-8000-000000000102', 'Your thread was restored', '/dashboard/notifications');

select is(
  (select count(*)::integer from public.notifications
   where user_id = '5e5e5e5e-0000-4000-8000-000000000001'
     and type = 'content_restored'),
  1,
  'notifications accept the content_restored type'
);

-- ─── 7. Cleanup ─────────────────────────────────────────────
delete from public.content_reports
where reporter_id in (
  '5e5e5e5e-0000-4000-8000-000000000001',
  '5e5e5e5e-0000-4000-8000-000000000002'
);
delete from public.notifications
where user_id = '5e5e5e5e-0000-4000-8000-000000000001';
delete from public.content_removals
where content_id = '5e5e5e5e-0000-4000-8000-000000000101';
delete from public.users where email like '%@content-reports.test';

select is(
  (select count(*)::integer from public.users
   where email like '%@content-reports.test'),
  0,
  'cleanup removed the fixture users'
);

select * from finish();
