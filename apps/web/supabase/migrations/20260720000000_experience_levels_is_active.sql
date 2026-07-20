-- Add is_active and updated_at to experience_levels so they can be
-- deactivated (hidden from dropdowns) and have proper timestamps.

ALTER TABLE experience_levels
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Back-fill updated_at from created_at for existing rows
UPDATE experience_levels SET updated_at = created_at WHERE updated_at = now();

-- Keep updated_at fresh on every update
CREATE OR REPLACE FUNCTION set_experience_levels_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_experience_levels_updated_at ON experience_levels;
CREATE TRIGGER trg_experience_levels_updated_at
  BEFORE UPDATE ON experience_levels
  FOR EACH ROW EXECUTE FUNCTION set_experience_levels_updated_at();
