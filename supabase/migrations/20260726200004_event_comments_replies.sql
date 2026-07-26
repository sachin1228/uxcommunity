-- Add parent_id to event_comments for threaded replies (unlimited depth)
alter table event_comments
  add column if not exists parent_id uuid references event_comments (id) on delete cascade;

create index if not exists idx_event_comments_parent on event_comments (parent_id) where parent_id is not null;
