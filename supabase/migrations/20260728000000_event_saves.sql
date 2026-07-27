-- ============================================================
-- Event saves (bookmarks)
--
-- Members can save events to their personal collection.
-- Toggle: insert when not saved, delete when already saved.
-- ============================================================

create table if not exists event_saves (
  event_id    uuid not null references community_events (id) on delete cascade,
  user_id     uuid not null references users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index if not exists idx_event_saves_user
  on event_saves (user_id, created_at desc);

alter table event_saves enable row level security;

create policy "members_read" on event_saves
  for select using (true);

create policy "members_insert" on event_saves
  for insert with check (auth.uid()::text = user_id::text);

create policy "members_delete" on event_saves
  for delete using (auth.uid()::text = user_id::text);
