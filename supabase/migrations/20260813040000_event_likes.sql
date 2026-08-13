-- Persist event likes so every signed-in surface can show the same state.
-- Writes are performed by authenticated Next.js API routes through the
-- service client; clients only receive read access.

create table if not exists public.event_likes (
  event_id uuid not null references public.community_events (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index if not exists idx_event_likes_event
  on public.event_likes (event_id);

create index if not exists idx_event_likes_user
  on public.event_likes (user_id, created_at desc);

alter table public.event_likes enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'event_likes'
      and policyname = 'public_read'
  ) then
    create policy public_read on public.event_likes
      for select using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'event_likes'
  ) then
    alter publication supabase_realtime add table public.event_likes;
  end if;
end
$$;

alter table public.event_likes replica identity full;
