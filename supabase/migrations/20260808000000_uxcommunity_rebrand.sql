-- UX Community rebrand: keep existing community records aligned with the
-- product name without changing IDs, relationships, or user data.
UPDATE communities
SET description = 'The default community for every UX Community designer.'
WHERE type = 'general'
  AND description ILIKE '%default community%';