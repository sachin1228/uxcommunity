-- ============================================================
-- Resource comments
--
-- Members can comment on resources. One level of nested replies
-- supported (same pattern as thread_comments / event_comments).
-- ============================================================

create table if not exists resource_comments (
  id           uuid primary key default gen_random_uuid(),
  resource_id  uuid not null references community_resources (id) on delete cascade,
  user_id      uuid not null references users (id) on delete cascade,
  parent_id    uuid references resource_comments (id) on delete cascade,
  body         text not null check (char_length(body) between 1 and 5000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_resource_comments_resource_time
  on resource_comments (resource_id, created_at asc);

create index if not exists idx_resource_comments_parent
  on resource_comments (parent_id);

create or replace trigger trg_resource_comments_updated_at
  before update on resource_comments
  for each row execute function set_updated_at();

alter table resource_comments enable row level security;

create policy "public_read" on resource_comments
  for select using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'resource_comments'
  ) then
    alter publication supabase_realtime add table resource_comments;
  end if;
end $$;

alter table resource_comments replica identity full;
