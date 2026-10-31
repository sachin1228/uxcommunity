-- Permission regression test for the launch security model.
--
-- The app reads/writes through the service-role client and its realtime
-- service never uses PostgREST. The seven tables named in
-- 20261030240000_revoke_client_select_on_launch_tables.sql are therefore
-- deliberately closed to anon/authenticated. This test is SCOPED to those
-- tables rather than asserting a blanket zero across public: an intentional
-- public-read table is still allowed when a migration grants it explicitly.
--
-- It also proves the default-ACL hardening: new tables/functions do not
-- inherit client access, while service_role and an explicitly public table
-- continue to work.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- 1. Exactly the seven intended sensitive tables are in scope.
select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p')
     and c.relname in ('content_reports','content_removals','fcm_tokens',
                       'account_verification_requests','verification_email_codes',
                       'verification_settings','member_resumes')),
  7,
  'the sensitive-table set contains exactly seven tables'
);

-- 2. No client role can SELECT any of the seven.
select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p')
     and c.relname in ('content_reports','content_removals','fcm_tokens',
                       'account_verification_requests','verification_email_codes',
                       'verification_settings','member_resumes')
     and (has_table_privilege('anon', c.oid, 'SELECT')
          or has_table_privilege('authenticated', c.oid, 'SELECT'))),
  0,
  'no sensitive table grants SELECT to anon or authenticated'
);

-- 3. The service role keeps all seven.
select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p')
     and c.relname in ('content_reports','content_removals','fcm_tokens',
                       'account_verification_requests','verification_email_codes',
                       'verification_settings','member_resumes')
     and has_table_privilege('service_role', c.oid, 'SELECT')),
  7,
  'service_role retains SELECT on all seven sensitive tables'
);

-- 4. Every public table keeps RLS, independent of grants.
select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity),
  0,
  'every public table has row level security enabled'
);

-- 5. No unrestricted read policy targets a client role.
select is(
  (select count(*)::integer from pg_policies
   where schemaname = 'public' and cmd in ('SELECT','ALL')
     and (qual is null or qual = 'true')
     and roles && array['public','anon','authenticated']::name[]),
  0,
  'no USING (true) read policy targets public, anon or authenticated'
);

-- 6. Supabase Realtime is not used.
select is(
  (select count(*)::integer from pg_publication_tables where pubname = 'supabase_realtime'),
  0,
  'the supabase_realtime publication is empty'
);

-- 7. Service role still reads application data.
select ok(
  has_table_privilege('service_role', 'public.community_messages', 'SELECT'),
  'service_role retains read access to community_messages'
);

-- 8/9. A new table created by postgres has service_role access but no
-- inherited client access. This is the default-ACL regression guard.
create table public.__default_priv_probe (id integer);
select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = '__default_priv_probe'
     and (has_table_privilege('anon', c.oid, 'SELECT')
          or has_table_privilege('authenticated', c.oid, 'SELECT'))),
  0,
  'a new public table does not inherit anon/authenticated grants'
);
select ok(
  has_table_privilege('service_role', 'public.__default_priv_probe', 'SELECT'),
  'service_role can read a new public table'
);

-- 10. PostgreSQL's built-in PUBLIC EXECUTE cannot be removed by default
-- privileges. The enforceable convention is that every sensitive function
-- migration revokes PUBLIC/anon/authenticated and grants service_role. Check a
-- representative RPC, not a misleading claim about every future function.
select ok(
  not has_function_privilege('anon', 'public.set_user_blocked(uuid,boolean,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.set_user_blocked(uuid,boolean,text)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.set_user_blocked(uuid,boolean,text)', 'EXECUTE'),
  'sensitive RPCs keep client EXECUTE revoked and service_role access'
);

-- 11. The service-role default grant keeps future functions callable by the
-- app even though PUBLIC EXECUTE remains a PostgreSQL built-in.
create function public.__default_fn_probe() returns integer
  language sql as $$ select 1 $$;
select ok(
  has_function_privilege('service_role', 'public.__default_fn_probe()', 'EXECUTE'),
  'service_role can execute a new function'
);
drop function public.__default_fn_probe();

-- 12. An explicitly public-read table still works. The current app has no
-- intentionally public Data API tables, but the security model must not make
-- that impossible by accident.
create table public.__public_read_probe (id integer);
alter table public.__public_read_probe enable row level security;
create policy __public_read_probe_read on public.__public_read_probe
  for select to anon using (true);
grant select on public.__public_read_probe to anon;
set local role anon;
select is((select count(*)::integer from public.__public_read_probe), 0,
  'an explicitly granted public-read table remains readable');
reset role;
drop table public.__public_read_probe;

-- 13/14. Direct client access to two representative sensitive tables fails at
-- the privilege layer, not merely because of an empty policy.
set local role anon;
select throws_ok(
  'select 1 from public.content_reports',
  '42501', null,
  'anon cannot read content_reports'
);
select throws_ok(
  'select 1 from public.fcm_tokens',
  '42501', null,
  'anon cannot read fcm_tokens'
);
reset role;

-- 15. The authenticated role is also closed on the resume table (its own-row
-- policies remain, but there is no grant for them to act on).
set local role authenticated;
select throws_ok(
  'select 1 from public.member_resumes',
  '42501', null,
  'authenticated cannot read member_resumes'
);
reset role;

select * from finish();
rollback;
