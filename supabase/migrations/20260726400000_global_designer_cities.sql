-- ============================================================
-- Migration: Add top global cities where designers are concentrated.
--
-- Sources: Noble Desktop UX City Guide, Figma Blog international
-- design communities, LinkedIn product designer hiring data (2026).
--
-- Americas: San Francisco, New York City, Los Angeles, Seattle,
--           Austin, Toronto, São Paulo
-- Europe:   London, Berlin, Amsterdam, Paris, Stockholm,
--           Barcelona, Lisbon
-- Asia-Pacific: Tokyo, Singapore, Seoul, Sydney, Melbourne
-- Middle East:  Dubai
--
-- City illustration assets are in attached_assets/cities/
-- Upload each image to Supabase Storage (master-data-images bucket)
-- and update image_url via the Admin → Cities panel.
-- ============================================================

insert into cities (name, is_active) values
  -- Americas
  ('San Francisco', true),
  ('New York City', true),
  ('Los Angeles',   true),
  ('Seattle',       true),
  ('Austin',        true),
  ('Toronto',       true),
  ('São Paulo',     true),

  -- Europe
  ('London',        true),
  ('Berlin',        true),
  ('Amsterdam',     true),
  ('Paris',         true),
  ('Stockholm',     true),
  ('Barcelona',     true),
  ('Lisbon',        true),

  -- Asia-Pacific
  ('Tokyo',         true),
  ('Singapore',     true),
  ('Seoul',         true),
  ('Sydney',        true),
  ('Melbourne',     true),

  -- Middle East
  ('Dubai',         true)

on conflict (name) do nothing;
