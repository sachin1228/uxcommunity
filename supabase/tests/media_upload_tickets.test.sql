-- ============================================================
-- AUD-07 — media_upload_tickets ownership/one-time state
--
-- Migration under test: 20261106120000_media_upload_tickets.sql
--
-- The direct-to-R2 finalize path trusts this table, not the request body, for
-- ownership, expiry and expected size. These assertions pin the table's shape
-- and lockdown: a public or authenticated role that could write it would let a
-- client forge an owner, and a missing unique media_id would let two tickets
-- race the same object.
-- ============================================================

begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select has_table('public', 'media_upload_tickets', 'ticket table exists');

select col_is_pk('public', 'media_upload_tickets', 'id', 'ticket id is the primary key');

select col_is_unique(
  'public',
  'media_upload_tickets',
  'media_id',
  'one ticket per media id'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.media_upload_tickets'::regclass),
  'row level security is enabled'
);

select ok(
  not has_table_privilege('anon', 'public.media_upload_tickets', 'INSERT')
  and has_table_privilege('service_role', 'public.media_upload_tickets', 'INSERT'),
  'only service_role may insert tickets'
);

select * from finish();
rollback;
