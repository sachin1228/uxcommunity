-- Remove the description column from community_threads.
-- Threads now use title only (the body textarea maps directly to title).

-- Back-fill: set description = title for any rows that might have mismatched data
UPDATE public.community_threads SET description = title WHERE description IS NULL OR description = '';

ALTER TABLE public.community_threads
  DROP COLUMN description;
