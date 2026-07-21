-- Add is_active flag to communities so admins can deactivate without hard-deleting.
-- Defaults to true so all existing communities stay visible.
alter table communities
  add column if not exists is_active boolean not null default true;

create index if not exists idx_communities_is_active on communities (is_active);
