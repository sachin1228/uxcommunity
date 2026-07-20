-- Add last_read_at to community_members so unread counts are per-user, not global.
-- When a user opens a community, we update this timestamp.
-- The sidebar API counts only messages from others after this timestamp.
alter table community_members
  add column if not exists last_read_at timestamptz;

-- Index: sidebar query filters messages after the minimum last_read_at across
-- all of the current user's communities — so this index pays for itself.
create index if not exists idx_community_messages_room_unread
  on community_messages (community_id, user_id, created_at asc);
