-- Community photo upload diagnostic
-- Copy this entire file into the Supabase SQL editor and run it.
-- Read-only: this file does not change schema or data.

select jsonb_build_object(
  'columns', (
    select coalesce(jsonb_agg(to_jsonb(c) order by c.ordinal_position), '[]'::jsonb)
    from (
      select column_name, data_type, is_nullable, column_default, ordinal_position
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'communities'
    ) c
  ),
  'community', (
    select to_jsonb(c)
    from public.communities c
    where c.id = 'db2af78e-eac5-4d28-bba0-c8035e8deadb'
  ),
  'triggers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', t.tgname,
      'definition', pg_get_triggerdef(t.oid)
    )), '[]'::jsonb)
    from pg_trigger t
    where t.tgrelid = 'public.communities'::regclass
      and not t.tgisinternal
  ),
  'policies', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'name', p.policyname,
      'command', p.cmd,
      'roles', p.roles,
      'using', p.qual,
      'with_check', p.with_check
    )), '[]'::jsonb)
    from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'communities'
  ),
  'grants', (
    select coalesce(jsonb_agg(to_jsonb(g)), '[]'::jsonb)
    from (
      select grantee, privilege_type, is_grantable
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = 'communities'
      order by grantee, privilege_type
    ) g
  )
) as community_photo_diagnostic;
