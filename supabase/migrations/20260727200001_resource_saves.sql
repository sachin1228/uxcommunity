-- ============================================================
-- Resource saves (bookmarks)
--
-- Members can save resources to their personal collection.
-- Toggle: inserting when not saved, deleting when already saved.
-- ============================================================

create table if not exists resource_saves (
  resource_id  uuid not null references community_resources (id) on delete cascade,
  user_id      uuid not null references users (id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (resource_id, user_id)
);

create index if not exists idx_resource_saves_user
  on resource_saves (user_id, created_at desc);

alter table resource_saves enable row level security;

create policy "public_read" on resource_saves
  for select using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'resource_saves'
  ) then
    alter publication supabase_realtime add table resource_saves;
  end if;
end $$;

alter table resource_saves replica identity full;
