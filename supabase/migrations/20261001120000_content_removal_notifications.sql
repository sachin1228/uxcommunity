-- ============================================================
-- Content-removal notifications
--
-- When a community manager (owner / admin / moderator) removes another
-- member's thread, showcase post, resource or event, the author now gets a
-- notification. Two CHECK constraints are in the way:
--
--   1. notifications_type_check — rebuilt by
--      20260915120000_remove_broadcast_and_mention_notifications.sql without
--      the *_deleted types. The four new types exactly mirror the
--      community_admin_activity actions logged by the delete routes.
--   2. notifications_entity_type_check — rebuilt by
--      20260904120000_chat_mentions.sql. Showcase never had a notification
--      and so was never in the list.
--
-- The unique unread-dedupe index (user_id, entity_type, entity_id) from
-- 20260928140000 applies unchanged: a removal aggregates into that entity's
-- existing unread notification and supersedes its copy, which is the right
-- final state once the content is gone.
-- ============================================================

-- 1. Allow the removal types.
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
      'event_rsvp',
      'thread_deleted',
      'showcase_deleted',
      'resource_deleted',
      'event_deleted'
    )
  );

-- 2. Allow showcase as an entity kind.
alter table public.notifications
  drop constraint if exists notifications_entity_type_check;

alter table public.notifications
  add constraint notifications_entity_type_check check (
    entity_type in ('community', 'thread', 'resource', 'event', 'message', 'showcase')
  );
