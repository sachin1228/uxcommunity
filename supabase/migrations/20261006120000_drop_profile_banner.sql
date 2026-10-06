-- ============================================================
-- Drop the profile banner column
--
-- The profile hero no longer renders a cover image, so `banner_url` has no
-- reader left: no RPC selects it and no surface writes it. Dropping it here
-- keeps the schema honest instead of leaving a column nothing can reach.
--
-- The entries in ALL_MEDIA_LOOKUPS are dropped alongside it, so the objects
-- already written under `banners/` stop counting as live references and the
-- admin orphan audit (Tools → R2 storage health) lists them for deletion.
-- ============================================================

alter table designer_profiles
  drop column if exists banner_url;
