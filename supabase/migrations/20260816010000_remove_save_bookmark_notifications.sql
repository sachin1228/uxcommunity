-- ============================================================
-- Remove save/bookmark notifications
--
-- Saves and bookmarks no longer generate notifications (the API
-- routes no longer call createNotification for them). This migration:
--   1. Deletes any existing thread_save / resource_save /
--      resource_bookmark notifications still sitting in users' bells.
--   2. Rebuilds the notifications.type CHECK constraint so those three
--      types can no longer be inserted.
-- ============================================================

-- 1. Remove existing save/bookmark notifications.
delete from notifications
where type in ('thread_save', 'resource_save', 'resource_bookmark');

-- 2. Rebuild the type CHECK constraint without the removed types.
alter table notifications
  drop constraint notifications_type_check;

alter table notifications
  add constraint notifications_type_check check (
    type in (
      'community_thread',
      'community_resource',
      'community_event',
      'thread_comment',
      'thread_reply',
      'thread_vote',
      'resource_comment',
      'resource_reply',
      'event_comment',
      'event_reply',
      'event_rsvp',
      'event_save'
    )
  );