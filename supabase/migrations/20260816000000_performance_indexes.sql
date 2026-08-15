-- ============================================================
-- Performance indexes for free-tier capacity
--
-- 1. notifications: support the dedupe lookup in createNotification
--    (user_id + entity_type + entity_id + read_at is null). Without a
--    dedicated index this query would scan the user's whole notification
--    history on every interaction that generates a notification.
-- ============================================================

create index if not exists idx_notifications_user_entity_unread
  on notifications (user_id, entity_type, entity_id)
  where read_at is null;