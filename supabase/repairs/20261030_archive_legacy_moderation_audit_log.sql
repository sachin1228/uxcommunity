-- ============================================================
-- One-off production repair: archive the legacy moderation audit table
--
-- NOT a migration. Do not put this in supabase/migrations and do not apply it
-- automatically. Run it once, manually, only after taking a production backup.
--
-- WHY
--   Production already has public.moderation_audit_log with a legacy shape:
--     moderator_email, target_user_id, target_content_type, ...
--   20261030220000_complete_moderation_system.sql uses
--   `create table if not exists public.moderation_audit_log`, so it skips the
--   existing table and later fails on `target_type`:
--
--     ERROR: 42703: column "target_type" does not exist
--
--   This script renames the legacy table (and every index attached to it) so
--   the migration can create the new audit table under the canonical name.
--   It does not drop the legacy table, delete rows, or rewrite data.
--
-- BEFORE RUNNING
--   1. Back up production / confirm a restorable snapshot.
--   2. Confirm interaction_reports is empty or understood. This script does not
--      touch it.
--   3. Confirm no application deployment still reads the legacy audit columns
--      (moderator_email, target_user_id, target_content_type). The current
--      application uses the new audit schema.
--   4. Run this inside a transaction (the script does that itself). If any
--      guard raises, nothing is changed.
--
-- AFTER RUNNING
--   Run, in order:
--     20261030220000_complete_moderation_system.sql
--     20261030230000_preserve_moderation_evidence.sql
--   Then verify the new audit table exists and the legacy table still has its
--   rows:
--     select count(*) from public.moderation_audit_log;
--     select count(*) from public.moderation_audit_log_legacy_20261030;
-- ============================================================

begin;

do $$
declare
  has_target_type boolean;
  has_legacy_column boolean;
  legacy_rows bigint;
begin
  if to_regclass('public.moderation_audit_log') is null then
    raise exception
      'public.moderation_audit_log does not exist; nothing to archive';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'moderation_audit_log'
      and column_name = 'target_type'
  ) into has_target_type;

  if has_target_type then
    raise exception
      'moderation_audit_log already has target_type; it is not the legacy table. Aborting.';
  end if;

  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'moderation_audit_log'
      and column_name = 'moderator_email'
  ) into has_legacy_column;

  if not has_legacy_column then
    raise exception
      'moderation_audit_log is not the expected legacy shape (moderator_email missing). Inspect it before renaming.';
  end if;

  execute 'select count(*) from public.moderation_audit_log' into legacy_rows;
  raise notice 'Archiving % legacy moderation audit row(s).', legacy_rows;

  if to_regclass('public.moderation_audit_log_legacy_20261030') is not null then
    raise exception
      'public.moderation_audit_log_legacy_20261030 already exists; refusing to overwrite it.';
  end if;
end $$;

-- Keep the legacy rows under a dated archive name. Renaming the table also
-- leaves its constraints and grants intact.
alter table public.moderation_audit_log
  rename to moderation_audit_log_legacy_20261030;

-- Index names are schema-wide. Rename every index that followed the table, so
-- the new moderation_audit_log can create its own indexes with the canonical
-- names. This includes the primary-key index and the index the failed
-- migration may already have created on the legacy table.
do $$
declare
  index_row record;
  new_name text;
begin
  for index_row in
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'moderation_audit_log_legacy_20261030'
  loop
    new_name := left(index_row.indexname || '_legacy_20261030', 63);
    execute format(
      'alter index public.%I rename to %I',
      index_row.indexname,
      new_name
    );
  end loop;
end $$;

commit;

-- Verification (read-only):
-- select count(*) as legacy_rows
-- from public.moderation_audit_log_legacy_20261030;
--
-- The canonical name must be free now:
-- select to_regclass('public.moderation_audit_log') as canonical_table;
-- expect NULL before rerunning the migration.
