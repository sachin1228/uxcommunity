-- ============================================================
-- A description may carry formatting
--
-- WHY
--   The column was sized for plain text: 8000 characters, measured on the
--   stored value. The "About the role" field now stores a restricted subset of
--   html instead, so that a role pasted from a doc keeps its bullets, headings
--   and spacing (the subset and its rules live in
--   apps/web/lib/jobs/rich-text.ts). Markup is longer than the words it
--   formats, so a poster who wrote a full-length description and formatted it
--   would have been refused by the database — with a check violation, not a
--   message about the description.
--
-- WHAT
--   The check is re-stated with room for the tags. The poster-facing rule does
--   not change: still 8000 characters of text, still at least one of them. The
--   extra headroom is for the markup, and it is deliberately generous (three
--   times the text) because the two numbers measure different things — the
--   application cap on the markup is the tighter of the two, and it can say so
--   in words.
--
--   Keep this number in step with RICH_TEXT_MAX_HTML_CHARS in
--   apps/web/lib/jobs/rich-text.ts, and RICH_TEXT_MAX_CHARS (8000) with the
--   text the field accepts.
--
--   The meaning of the column does not change and no row is rewritten: every
--   description already stored is plain text with no tags in it, and the reader
--   draws that exactly as the old `whitespace-pre-line` did.
--
-- Deploy note: one constraint swap on one table. The three functions that
-- touch the column — create_job_post, update_job_post and job_post_payload —
-- pass it through unchanged and need no replacement.
-- ============================================================

-- Named rather than anonymous so this stays a replaceable swap: an unnamed
-- check is one dump/restore away from a name nothing here can drop.
alter table public.job_posts
  drop constraint if exists job_posts_description_check;

alter table public.job_posts
  add constraint job_posts_description_check
  check (char_length(btrim(description)) between 1 and 24000);
