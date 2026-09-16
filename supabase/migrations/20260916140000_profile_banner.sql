-- ============================================================
-- Profile banner image
--
-- The profile hero renders a gradient when there is no cover image. The
-- gradient is a placeholder, not the member's picture: the avatar is a
-- separate upload (`avatar_url`), so the banner needs its own column rather
-- than reusing the DP.
--
-- Nullable on purpose — every existing profile keeps the gradient until the
-- member uploads a cover from the hero's "Edit banner" button.
-- ============================================================

alter table designer_profiles
  add column if not exists banner_url text;
