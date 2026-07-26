-- ============================================================
-- Event comments
-- Members can post comments/discussion on an event.
-- Writes go through the Next.js API (custom cookie sessions).
-- ============================================================

create table if not exists event_comments (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references community_events (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_event_comments_event on event_comments (event_id, created_at);
create index if not exists idx_event_comments_user  on event_comments (user_id);

create or replace trigger trg_event_comments_updated_at
  before update on event_comments
  for each row execute function set_updated_at();

alter table event_comments enable row level security;

create policy "public_read" on event_comments
  for select using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'event_comments'
  ) then
    alter publication supabase_realtime add table event_comments;
  end if;
end $$;

alter table event_comments replica identity full;
