-- ============================================================
-- Resource bookmarks (saves)
--
-- Members can bookmark resources to their personal collection.
-- Separate from likes (resource_saves).
-- Toggle: insert when not bookmarked, delete when already bookmarked.
-- ============================================================

create table if not exists resource_bookmarks (
  resource_id  uuid not null references community_resources (id) on delete cascade,
  user_id      uuid not null references users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (resource_id, user_id)
);

create index if not exists idx_resource_bookmarks_user
  on resource_bookmarks (user_id, created_at desc);

alter table resource_bookmarks enable row level security;

create policy "public_read" on resource_bookmarks
  for select using (true);
