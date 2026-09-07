-- ============================================================
-- Thread poll undo (one-time)
--
-- Lets a voter undo their vote exactly once per poll, then vote
-- again. Enforced server-side:
--
--   * option_index becomes nullable — null means "voted, then
--     undone" (the row must stay so the undo limit survives).
--   * undo_used = true once the undo has been exercised; further
--     undo attempts are rejected (409).
--   * Null option rows never count toward totals (readers skip
--     non-integer indices).
-- ============================================================

alter table public.thread_poll_votes
  alter column option_index drop not null;

alter table public.thread_poll_votes
  drop constraint if exists thread_poll_votes_option_index_check;

alter table public.thread_poll_votes
  add constraint thread_poll_votes_option_index_check
  check (option_index is null or option_index >= 0);

alter table public.thread_poll_votes
  add column if not exists undo_used boolean not null default false;