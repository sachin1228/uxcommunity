-- Keep event likes persistent and synchronized across the homepage, event lists,
-- and event detail pages. Event likes are stored as one row per user/event.

create table if not exists public.event_saves (
  event_id uuid not null references public.community_events (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

create index if not exists idx_event_saves_user
  on public.event_saves (user_id, created_at desc);

create index if not exists idx_event_saves_event
  on public.event_saves (event_id);

alter table public.event_saves enable row level security;

-- Counts are visible anywhere an event is visible. Mutations remain scoped to
-- the signed-in Supabase user when the Data API is used directly.
drop policy if exists "members_read" on public.event_saves;
create policy "members_read" on public.event_saves
  for select
  to anon, authenticated
  using (true);

drop policy if exists "members_insert" on public.event_saves;
create policy "members_insert" on public.event_saves
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "members_delete" on public.event_saves;
create policy "members_delete" on public.event_saves
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

grant select on table public.event_saves to anon, authenticated;
grant insert, delete on table public.event_saves to authenticated;

-- DELETE events need the old event_id value so filtered realtime listeners can
-- refresh the correct card after an unlike.
alter table public.event_saves replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'event_saves'
  ) then
    alter publication supabase_realtime add table public.event_saves;
  end if;
end $$;
