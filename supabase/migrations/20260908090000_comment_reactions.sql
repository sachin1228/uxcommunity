-- Reactions shared by thread, resource, showcase, and event comments.
-- Writes are performed by authenticated Next.js API routes; RLS keeps direct
-- client access read-only except for a user's own rows.

create table if not exists public.comment_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  emoji text not null check (emoji in ('👍', '❤️', '🎉', '💡', '👏')),
  thread_comment_id uuid references public.thread_comments(id) on delete cascade,
  resource_comment_id uuid references public.resource_comments(id) on delete cascade,
  showcase_comment_id uuid references public.showcase_comments(id) on delete cascade,
  event_comment_id uuid references public.event_comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comment_reactions_exactly_one_comment check (
    num_nonnulls(thread_comment_id, resource_comment_id, showcase_comment_id, event_comment_id) = 1
  )
);

create unique index if not exists comment_reactions_thread_unique
  on public.comment_reactions (thread_comment_id, user_id, emoji)
  where thread_comment_id is not null;
create unique index if not exists comment_reactions_resource_unique
  on public.comment_reactions (resource_comment_id, user_id, emoji)
  where resource_comment_id is not null;
create unique index if not exists comment_reactions_showcase_unique
  on public.comment_reactions (showcase_comment_id, user_id, emoji)
  where showcase_comment_id is not null;
create unique index if not exists comment_reactions_event_unique
  on public.comment_reactions (event_comment_id, user_id, emoji)
  where event_comment_id is not null;

create index if not exists comment_reactions_thread_lookup
  on public.comment_reactions (thread_comment_id) where thread_comment_id is not null;
create index if not exists comment_reactions_resource_lookup
  on public.comment_reactions (resource_comment_id) where resource_comment_id is not null;
create index if not exists comment_reactions_showcase_lookup
  on public.comment_reactions (showcase_comment_id) where showcase_comment_id is not null;
create index if not exists comment_reactions_event_lookup
  on public.comment_reactions (event_comment_id) where event_comment_id is not null;

alter table public.comment_reactions enable row level security;

drop policy if exists comment_reactions_read on public.comment_reactions;
create policy comment_reactions_read on public.comment_reactions
  for select using (true);

drop policy if exists comment_reactions_insert_own on public.comment_reactions;
create policy comment_reactions_insert_own on public.comment_reactions
  for insert with check (auth.uid() = user_id);

drop policy if exists comment_reactions_delete_own on public.comment_reactions;
create policy comment_reactions_delete_own on public.comment_reactions
  for delete using (auth.uid() = user_id);

drop trigger if exists set_comment_reactions_updated_at on public.comment_reactions;
create trigger set_comment_reactions_updated_at
  before update on public.comment_reactions
  for each row execute function public.set_updated_at();

alter table public.comment_reactions replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'comment_reactions'
  ) then
    alter publication supabase_realtime add table public.comment_reactions;
  end if;
end $$;
