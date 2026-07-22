-- Migration: Drop experience_level PG enum, use text instead
--
-- Previously, designer_profiles.experience_level was typed as the PG enum
-- experience_level, which required any stored value to be one of the 14
-- hardcoded enum members. This caused a mismatch with the experience_levels
-- lookup table (managed via the admin panel), whose slugs were not guaranteed
-- to match the enum values.
--
-- After this migration:
--   • designer_profiles.experience_level is plain text
--   • The experience_levels table (slug + name) is the sole source of truth
--   • Admins can add/rename experience levels without code or migration changes
--   • Existing rows retain their stored value (the old enum label string) unchanged

-- Step 1: convert the column from the enum type to text
ALTER TABLE designer_profiles
  ALTER COLUMN experience_level TYPE text;

-- Step 2: remove the now-unused enum type
DROP TYPE IF EXISTS experience_level;
