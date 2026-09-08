-- Emoji reactions on thread comments. Writes go through the authenticated
-- Next.js API route; RLS keeps direct client access read-only.
-- Scoped to threads only — other comment sections can adopt the same pattern
-- later by adding their own FK column + indexes.

create table if not exists public.thread_comment_reactions (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.thread_comments(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '🎉', '💡', '👏')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint thread_comment_reactions_unique
    unique (comment_id, user_id, emoji)
);

create index if not exists thread_comment_reactions_lookup
  on public.thread_comment_reactions (comment_id);

alter table public.thread_comment_reactions enable row level security;

drop policy if exists thread_comment_reactions_read on public.thread_comment_reactions;
create policy thread_comment_reactions_read on public.thread_comment_reactions
  for select using (true);

drop policy if exists thread_comment_reactions_insert_own on public.thread_comment_reactions;
create policy thread_comment_reactions_insert_own on public.thread_comment_reactions
  for insert with check (auth.uid() = user_id);

drop policy if exists thread_comment_reactions_delete_own on public.thread_comment_reactions;
create policy thread_comment_reactions_delete_own on public.thread_comment_reactions
  for delete using (auth.uid() = user_id);

-- Keep updated_at current if a row is ever updated in place.
drop trigger if exists set_thread_comment_reactions_updated_at on public.thread_comment_reactions;
create trigger set_thread_comment_reactions_updated_at
  before update on public.thread_comment_reactions
  for each row execute function public.set_updated_at();
