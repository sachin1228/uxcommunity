-- ============================================================
-- Add 'general' community type + seed the default community
-- ============================================================

-- 1. Drop the old type check constraint and replace it with one that includes 'general'
ALTER TABLE communities
  DROP CONSTRAINT IF EXISTS communities_type_check;

ALTER TABLE communities
  ADD CONSTRAINT communities_type_check
  CHECK (type IN ('city', 'sector', 'interest', 'company', 'experience_level', 'general'));

-- 2. Make reference_id nullable so the general community needs no master-data row
ALTER TABLE communities
  ALTER COLUMN reference_id DROP NOT NULL;

-- 3. Partial unique index: only one 'general' community allowed
CREATE UNIQUE INDEX IF NOT EXISTS idx_communities_general_singleton
  ON communities (type)
  WHERE type = 'general';

-- 4. Seed the default general community (idempotent)
INSERT INTO communities (name, description, type, reference_id, is_active)
VALUES (
  'General',
  'The default community for every UX Community designer.',
  'general',
  NULL,
  true
)
ON CONFLICT DO NOTHING;
