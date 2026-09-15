-- ============================================================
-- Remove community-broadcast and chat-mention notifications
--
-- The API routes no longer create these types:
--   * the threads / resources / events POST routes dropped their
--     deferCommunityNotification calls (the "started a new thread",
--     "shared a new resource" and "created a new event" broadcasts), and
--   * the messages POST route dropped its chat_mention rows.
--
-- This migration:
--   1. Deletes the rows still sitting in users' notifications lists, so
--      the unread badge stops counting notifications the UI no longer
--      shows (and can no longer be linked to).
--   2. Rebuilds the notifications.type CHECK constraint without those
--      types, so nothing can insert them again. 'event_save' is dropped
--      here too — it was already dead (no route creates it since
--      20260816010000).
--
-- The entity_type CHECK is deliberately left as it is: 'message' and
-- 'community' are no longer written, but the wider list keeps the
-- constraint from failing on any pre-existing row.
-- ============================================================

-- 1. Remove the notification rows the app no longer generates.
delete from public.notifications
where type in (
  'community_thread',
  'community_resource',
  'community_event',
  'chat_mention',
  'event_save'
);

-- 2. Rebuild the type CHECK constraint without them.
alter table public.notifications
  drop constraint if exists notifications_type_check;

alter table public.notifications
  add constraint notifications_type_check check (
    type in (
      'thread_comment',
      'thread_reply',
      'thread_like',
      'resource_comment',
      'resource_reply',
      'event_comment',
      'event_reply',
      'event_rsvp'
    )
  );
