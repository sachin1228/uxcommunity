-- ============================================================
-- Content reports — the constraints the report flow relies on
--
-- Migration under test: 20261005120000_content_reports.sql
--
-- The report API trusts the database for three things, so each is proven here:
--
--   1. `reason` and `content_type` only accept the values the modal offers —
--      a bad payload from an old client is rejected, not stored;
--   2. the partial UNIQUE index allows exactly ONE pending report per member
--      per post (a duplicate submission is a 23505 the API maps to 409), yet
--      still lets the member report the same post again once their earlier
--      report was resolved;
--   3. the notifications type check accepts the new `report_reviewed` type the
--      reporter's thank-you is written with.
--
-- Commit-free and self-cleaning: every fixture is deleted at the end.
-- ============================================================

create extension if not exists pgtap with schema extensions;
select plan(13);

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

-- ─── 5. Cleanup ─────────────────────────────────────────────
delete from public.content_reports
where reporter_id in (
  '5e5e5e5e-0000-4000-8000-000000000001',
  '5e5e5e5e-0000-4000-8000-000000000002'
);
delete from public.notifications
where user_id = '5e5e5e5e-0000-4000-8000-000000000001';
delete from public.users where email like '%@content-reports.test';

select is(
  (select count(*)::integer from public.users
   where email like '%@content-reports.test'),
  0,
  'cleanup removed the fixture users'
);

select * from finish();
