-- ============================================================
-- Threads: trim categories to Question / Discussion / Idea / Feedback
--
-- The composer now offers exactly four categories. Move existing
-- 'referral' and 'collaboration' threads to the 'discussion'
-- catch-all so no data is lost, then narrow the check constraint
-- to match what the API and composer accept.
--
-- Idempotent: safe to re-run (e.g. from the SQL editor) if this
-- migration was already applied once.
-- ============================================================

update public.community_threads
  set category = 'discussion',
      updated_at = now()
  where category in ('referral', 'collaboration');

alter table public.community_threads
  drop constraint if exists community_threads_category_check;

alter table public.community_threads
  add constraint community_threads_category_check
  check (category in ('question', 'discussion', 'idea', 'feedback'));