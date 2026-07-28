-- Populate auto-generated descriptions for communities that have none.
-- Source tables (design_interests, design_sectors, cities, companies, etc.)
-- have no description column, so auto-created communities are born with NULL.
-- This migration fills in sensible fallbacks so the explore page shows something
-- meaningful. Communities that already have a description are left untouched.

UPDATE communities
SET description = CASE
  WHEN type = 'interest'         THEN 'A community for ' || name || ' enthusiasts and professionals. Share work, get feedback, and grow together.'
  WHEN type = 'city'             THEN 'Connect with designers based in ' || name || '. Local meetups, jobs, and conversations.'
  WHEN type = 'company'          THEN 'A space for designers at ' || name || ' to share ideas, resources, and support each other.'
  WHEN type = 'sector'           THEN 'Designers working in the ' || name || ' industry. Discuss trends, tools, and opportunities.'
  WHEN type = 'experience_level' THEN 'A community for ' || name || '. Peer support, career advice, and shared learning.'
  WHEN type = 'general'          THEN name || ' — an open community for designers everywhere.'
  WHEN type = 'user'             THEN name || ' — a member-led community.'
  ELSE name
END
WHERE description IS NULL OR trim(description) = '';
