-- ============================================================
-- Harden default privileges for future public objects
--
-- The seven-table revoke fixes today's grants, but Supabase's project default
-- ACL still grants anon/authenticated on every NEW table created by
-- postgres/supabase_admin. A migration that forgot its own revoke would
-- silently re-open the Data API for that table.
--
-- This changes the default for the role that creates application tables
-- (postgres). The `supabase_admin` defaults are platform-owned and may require
-- a dashboard/privileged change; the DO block reports instead of failing the
-- migration if this role cannot alter them, and the approval checklist records
-- the remaining manual step.
-- ============================================================

alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on functions from public, anon, authenticated;

-- New objects should still be usable by the server-side role. The service
-- role already bypasses RLS and receives explicit grants in each migration;
-- this default keeps the read path available if a future table forgets it.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;

alter default privileges for role postgres in schema public
  grant usage, select on sequences to service_role;

do $default_privileges$
begin
  begin
    execute 'alter default privileges for role supabase_admin in schema public
             revoke all on tables from public, anon, authenticated';
    execute 'alter default privileges for role supabase_admin in schema public
             revoke all on sequences from public, anon, authenticated';
    execute 'alter default privileges for role supabase_admin in schema public
             revoke all on functions from public, anon, authenticated';
  exception
    when insufficient_privilege then
      raise notice 'supabase_admin default privileges need a platform-privileged change';
  end;
end
$default_privileges$;

notify pgrst, 'reload schema';
