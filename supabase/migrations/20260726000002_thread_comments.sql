-- ============================================================
-- Thread comments
--
-- Top-level comments have parent_id = NULL.
-- Replies have parent_id pointing to a top-level comment.
-- Writes go through the Next.js API (custom cookie sessions).
-- ============================================================

create table if not exists thread_comments (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references community_threads (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  parent_id  uuid references thread_comments (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_thread_comments_thread    on thread_comments (thread_id, created_at);
create index if not exists idx_thread_comments_parent    on thread_comments (parent_id)  where parent_id is not null;
create index if not exists idx_thread_comments_user      on thread_comments (user_id);

create or replace trigger trg_thread_comments_updated_at
  before update on thread_comments
  for each row execute function set_updated_at();

alter table thread_comments enable row level security;

create policy "public_read" on thread_comments
  for select using (true);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'thread_comments'
  ) then
    alter publication supabase_realtime add table thread_comments;
  end if;
end $$;

alter table thread_comments replica identity full;
