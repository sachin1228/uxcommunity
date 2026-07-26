-- ============================================================
-- Thread votes (upvotes)
--
-- One vote per user per thread. Writes go through the Next.js
-- API because this app uses custom cookie sessions.
-- ============================================================

create table if not exists thread_votes (
  thread_id  uuid not null references community_threads (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists idx_thread_votes_thread on thread_votes (thread_id);

alter table thread_votes enable row level security;

create policy "public_read" on thread_votes
  for select using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'thread_votes'
  ) then
    alter publication supabase_realtime add table thread_votes;
  end if;
end $$;

alter table thread_votes replica identity full;
