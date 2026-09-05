-- ============================================================
-- Thread poll votes
--
-- One vote per (thread, user). option_index references the
-- option's position in community_threads.poll->'options'
-- (0-based). Votes are cleared whenever the poll payload on
-- the thread changes (see PATCH route) so stale indices can
-- never outlive their options.
-- ============================================================

create table if not exists public.thread_poll_votes (
  thread_id    uuid not null references public.community_threads (id) on delete cascade,
  user_id      uuid not null references public.users (id) on delete cascade,
  option_index integer not null check (option_index >= 0),
  created_at   timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists idx_thread_poll_votes_thread
  on public.thread_poll_votes (thread_id, option_index);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'thread_poll_votes'
  ) then
    alter publication supabase_realtime add table public.thread_poll_votes;
  end if;
end $$;

alter table public.thread_poll_votes replica identity full;
