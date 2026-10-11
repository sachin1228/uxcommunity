-- ============================================================
-- Timed community mutes
--
-- `notifications_muted` (20260918140000) is a forever switch: once a
-- member mutes a community, it stays muted until they say otherwise.
-- The community menu now offers durations (8 hours / 1 week / Always),
-- so the membership gains the second, self-expiring form of the same
-- decision:
--
--   * notifications_muted_until — a timed mute. While the deadline is
--     ahead the membership is muted; once it passes the row is NOT
--     rewritten, it simply reads as unmuted — nothing has to sweep it.
--   * notifications_muted — unchanged, now meaning "muted forever".
--     The mobile notifications screen keeps reading/writing this flag
--     with the same list semantics it always had.
--
-- Effective mute (every reader): notifications_muted = true OR
-- notifications_muted_until > now(). The chat push sender and the web
-- sidebar both evaluate it; unread counts are deliberately untouched —
-- an unread message is unread whether or not it was allowed to buzz.
-- ============================================================

alter table public.community_members
  add column if not exists notifications_muted_until timestamptz;

comment on column public.community_members.notifications_muted_until is
  'Timed mute: muted while the deadline is ahead; expired values are left in place and read as unmuted (see notifications_muted for the forever switch).';
