-- ============================================================
-- Migration: Capture columns that only ever existed in the live project
--
-- WHY
-- Generated database types are derived from this directory, so a column that
-- the app uses but no migration creates is invisible to the type checker and
-- to anyone rebuilding the database from scratch. Restoring TypeScript as a
-- safety mechanism surfaced three of them:
--
--   * experience_levels.is_active / updated_at
--   * designer_profiles.bio / linkedin_url / portfolio_url
--
-- Both sets are read and written by live API routes (see below), so they must
-- exist in the deployed project; the statements here are `if not exists` and
-- therefore no-ops wherever they are already present.
-- ============================================================

-- ─── experience_levels ──────────────────────────────────────
--
-- The table was created by 20260720_communities_company_experience.sql with
-- only (id, slug, name, image_url, created_at). Every consumer since assumes
-- the two columns its sibling master table has:
--
--   * apps/web/app/api/data/experience-levels/route.ts filters on is_active
--     to serve the signup form's dropdown;
--   * apps/web/app/api/admin/experience-levels/* toggles is_active and reads
--     updated_at when listing;
--   * complete_signup() (20260813020000, re-created since) rejects signups
--     whose level is not `is_active`.
--
-- `public.job_titles`, added later with the same shape, has both columns, so
-- the drift is specific to experience_levels: the columns exist in the live
-- project but were never captured in a migration. Generated database types
-- therefore omit them and the type-checker reports every read and write as
-- referencing a column that cannot exist.
--
-- WHAT
-- Adds the two columns so the versioned schema matches what the code and the
-- live project already assume. Both statements are `if not exists`, so this
-- is a no-op wherever the columns are already present (a plain column add is
-- metadata-only in PostgreSQL 11+, so it does not rewrite the table).
-- Defaults match job_titles: levels stay active, and updated_at mirrors
-- created_at for existing rows.
-- ============================================================

alter table public.experience_levels
  add column if not exists is_active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

-- Keep updated_at honest for future renames/toggles (same trigger function
-- the other master-data tables use).
create or replace trigger trg_experience_levels_updated_at
  before update on public.experience_levels
  for each row execute function set_updated_at();

-- ─── designer_profiles ──────────────────────────────────────
--
-- GET /api/profile selects these three alongside the rest of the profile row
-- and PATCH /api/profile writes them, so the profile page already depends on
-- them. No migration has ever created them.

alter table public.designer_profiles
  add column if not exists bio text,
  add column if not exists linkedin_url text,
  add column if not exists portfolio_url text;
