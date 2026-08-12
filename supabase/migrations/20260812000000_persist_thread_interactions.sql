-- Repair and harden persistence for public posts, likes, and saves.
-- This migration is idempotent so it can be run after any subset of the
-- earlier community thread migrations.

alter table public.community_threads
  alter column community_id drop not null;

alter table public.community_threads
  add column if not exists is_public boolean not null default false;

create index if not exists idx_community_threads_public_time
  on public.community_threads (created_at desc)
  where is_public = true;

create table if not exists public.thread_votes (
  thread_id uuid not null references public.community_threads (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists idx_thread_votes_thread
  on public.thread_votes (thread_id);

create index if not exists idx_thread_votes_user
  on public.thread_votes (user_id);

create table if not exists public.thread_saves (
  thread_id uuid not null references public.community_threads (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create index if not exists idx_thread_saves_thread
  on public.thread_saves (thread_id);

create index if not exists idx_thread_saves_user
  on public.thread_saves (user_id);

alter table public.thread_votes enable row level security;
alter table public.thread_saves enable row level security;

-- Reads and writes are performed by authenticated Next.js API routes through
-- the service client. No anon/authenticated write policy is intentionally
-- created, preventing clients from forging interactions for another user.

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'thread_votes'
      and policyname = 'public_read'
  ) then
    create policy public_read on public.thread_votes
      for select using (true);
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'thread_saves'
      and policyname = 'public_read'
  ) then
    create policy public_read on public.thread_saves
      for select using (true);
  end if;
end
$$;

comment on column public.community_threads.community_id is
  'Null for posts created directly from the public home feed.';

comment on column public.community_threads.is_public is
  'When true, logged-in users can view this thread in the public home feed.';
