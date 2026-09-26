-- Regression test for the public-read exposure closed by
-- 20260926000000_close_public_read_exposure.sql.
--
-- The app reads and writes the database exclusively through the server-side
-- service-role client, and its realtime runs on the Cloudflare worker in
-- apps/realtime — not on Supabase Realtime. So `anon` and `authenticated`
-- must have no way to reach application data through the Data API, and the
-- service role must keep its access.
--
-- These assertions fail if anyone re-adds a `using (true)` policy, a table
-- grant for a client role, a table with RLS switched off, or a
-- supabase_realtime publication entry.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

-- No table in `public` is readable by the client roles. Checked at the
-- privilege level as well as the policy level, because either one alone
-- re-opens the Data API.
select is(
  (select count(*)::integer
   from pg_class as c
   join pg_namespace as n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and (has_table_privilege('anon', c.oid, 'SELECT')
          or has_table_privilege('authenticated', c.oid, 'SELECT'))),
  0,
  'no public table grants SELECT to anon or authenticated'
);

-- Every table must keep RLS on, so revoking grants is never the only thing
-- standing between a client role and the rows.
select is(
  (select count(*)::integer
   from pg_class as c
   join pg_namespace as n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and not c.relrowsecurity),
  0,
  'every table in public has row level security enabled'
);

-- No unrestricted read policy remains for a client role.
select is(
  (select count(*)::integer
   from pg_policies
   where schemaname = 'public'
     and cmd in ('SELECT', 'ALL')
     and (qual is null or qual = 'true')
     and roles && array['public', 'anon', 'authenticated']::name[]),
  0,
  'no USING (true) read policy targets public, anon or authenticated'
);

-- The retired Supabase Realtime publication carries no tables.
select is(
  (select count(*)::integer
   from pg_publication_tables
   where pubname = 'supabase_realtime'),
  0,
  'the supabase_realtime publication no longer publishes any table'
);

-- The service role keeps working: it bypasses RLS and must still be able to
-- read, otherwise every API route breaks.
select ok(
  has_table_privilege('service_role', 'public.community_messages', 'SELECT'),
  'service_role retains read access to community_messages'
);

-- And the three tables named in the incident are unreachable in practice,
-- not merely policy-free.
set local role anon;

select throws_ok(
  'select 1 from public.community_messages',
  '42501',
  null,
  'anon cannot read community_messages'
);

select throws_ok(
  'select 1 from public.community_members',
  '42501',
  null,
  'anon cannot read community_members'
);

reset role;

select * from finish();
rollback;
