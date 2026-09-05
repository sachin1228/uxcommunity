-- ============================================================
-- Threads: widen title to 2000 chars + add optional poll JSON
--
-- Threads use title-only content (the composer textarea maps
-- directly to title). Widen it from 120 to 2000 so posts are
-- not silently truncated, matching the 2000-char moderation
-- cap and the composer's 0/2000 counter.
--
-- poll stores an optional object:
--   { "question": string, "options": [string, ...] }
-- with 2..6 options. Shape is validated by the API on write.
-- ============================================================

alter table public.community_threads
  alter column title type varchar(2000);

alter table public.community_threads
  drop constraint community_threads_title_check;

alter table public.community_threads
  add constraint community_threads_title_check
  check (char_length(title) between 1 and 2000);

alter table public.community_threads
  add column poll jsonb;

alter table public.community_threads
  add constraint community_threads_poll_object_check
  check (poll is null or jsonb_typeof(poll) = 'object');
