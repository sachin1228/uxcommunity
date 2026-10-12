-- ============================================================
-- Community-update push preference
--
-- The accepted-join-request notice is the first push that is not a chat
-- message, so it needs its own switch: a member who wants chat pushes (or who
-- wants none of them) can decide this one separately, and the chat switch's
-- settings copy — "Get push alerts for new chat messages." — stays true.
--
-- Defaults on, matching the other member-facing updates. Quiet hours and the
-- sound choice apply to it exactly as they do to chat.
--
-- Additive column with a default, so existing rows stay valid and no backfill
-- is needed.
-- ============================================================

alter table public.notification_preferences
  add column if not exists community_push_enabled boolean not null default true;
