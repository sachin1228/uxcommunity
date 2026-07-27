-- Per-user community archive state.
-- Archiving hides a community from one user's sidebar and clears only that
-- user's visible history; community rows and shared messages are untouched.
alter table community_members
  add column if not exists archived_at timestamptz,
  add column if not exists history_cleared_at timestamptz;

create index if not exists idx_community_members_user_archive
  on community_members (user_id, archived_at);