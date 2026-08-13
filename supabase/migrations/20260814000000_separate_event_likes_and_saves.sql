-- Separate event reactions (likes) from personal bookmarks (saves).
-- This migration is idempotent and safe to run after the historical event_saves migrations.

create table if not exists public.event_likes (
  event_id uuid not null references public.community_events (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint event_likes_pkey primary key (event_id, user_id)
);

create table if not exists public.event_saves (
  event_id uuid not null references public.community_events (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint event_saves_pkey primary key (event_id, user_id)
);

create index if not exists event_likes_user_created_idx
  on public.event_likes (user_id, created_at desc);
create index if not exists event_likes_event_idx
  on public.event_likes (event_id);
create index if not exists event_saves_user_created_idx
  on public.event_saves (user_id, created_at desc);
create index if not exists event_saves_event_idx
  on public.event_saves (event_id);

alter table public.event_likes enable row level security;
alter table public.event_saves enable row level security;

drop policy if exists "event_likes_read" on public.event_likes;
create policy "event_likes_read" on public.event_likes
  for select to anon, authenticated using (true);
drop policy if exists "event_likes_insert_own" on public.event_likes;
create policy "event_likes_insert_own" on public.event_likes
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "event_likes_delete_own" on public.event_likes;
create policy "event_likes_delete_own" on public.event_likes
  for delete to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "members_read" on public.event_saves;
drop policy if exists "members_insert" on public.event_saves;
drop policy if exists "members_delete" on public.event_saves;
drop policy if exists "event_saves_read" on public.event_saves;
create policy "event_saves_read" on public.event_saves
  for select to anon, authenticated using (true);
drop policy if exists "event_saves_insert_own" on public.event_saves;
create policy "event_saves_insert_own" on public.event_saves
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "event_saves_delete_own" on public.event_saves;
create policy "event_saves_delete_own" on public.event_saves
  for delete to authenticated using ((select auth.uid()) = user_id);

grant select on table public.event_likes, public.event_saves to anon, authenticated;
grant insert, delete on table public.event_likes, public.event_saves to authenticated;

alter table public.event_likes replica identity full;
alter table public.event_saves replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_likes'
  ) then
    alter publication supabase_realtime add table public.event_likes;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'event_saves'
  ) then
    alter publication supabase_realtime add table public.event_saves;
  end if;
end $$;

create or replace function public.get_home_feed_interactions(
  p_user_id uuid,
  p_thread_ids uuid[] default '{}'::uuid[],
  p_event_ids uuid[] default '{}'::uuid[],
  p_resource_ids uuid[] default '{}'::uuid[]
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'threads', coalesce((select jsonb_object_agg(ids.id, jsonb_build_object(
      'comment_count', (select count(*) from public.thread_comments c where c.thread_id = ids.id),
      'vote_count', (select count(*) from public.thread_votes v where v.thread_id = ids.id),
      'user_voted', exists(select 1 from public.thread_votes v where v.thread_id = ids.id and v.user_id = p_user_id),
      'user_saved', exists(select 1 from public.thread_saves s where s.thread_id = ids.id and s.user_id = p_user_id)
    )) from unnest(p_thread_ids) ids(id)), '{}'::jsonb),
    'events', coalesce((select jsonb_object_agg(ids.id, jsonb_build_object(
      'comment_count', (select count(*) from public.event_comments c where c.event_id = ids.id),
      'rsvp_count', (select count(*) from public.event_rsvps r where r.event_id = ids.id),
      'user_rsvped', exists(select 1 from public.event_rsvps r where r.event_id = ids.id and r.user_id = p_user_id),
      'like_count', (select count(*) from public.event_likes l where l.event_id = ids.id),
      'user_liked', exists(select 1 from public.event_likes l where l.event_id = ids.id and l.user_id = p_user_id),
      'save_count', (select count(*) from public.event_saves s where s.event_id = ids.id),
      'user_saved', exists(select 1 from public.event_saves s where s.event_id = ids.id and s.user_id = p_user_id)
    )) from unnest(p_event_ids) ids(id)), '{}'::jsonb),
    'resources', coalesce((select jsonb_object_agg(ids.id, jsonb_build_object(
      'comment_count', (select count(*) from public.resource_comments c where c.resource_id = ids.id),
      'save_count', (select count(*) from public.resource_saves s where s.resource_id = ids.id),
      'user_saved', exists(select 1 from public.resource_saves s where s.resource_id = ids.id and s.user_id = p_user_id),
      'bookmark_count', (select count(*) from public.resource_bookmarks b where b.resource_id = ids.id),
      'user_bookmarked', exists(select 1 from public.resource_bookmarks b where b.resource_id = ids.id and b.user_id = p_user_id)
    )) from unnest(p_resource_ids) ids(id)), '{}'::jsonb)
  );
$$;

revoke all on function public.get_home_feed_interactions(uuid, uuid[], uuid[], uuid[]) from public, anon, authenticated;
grant execute on function public.get_home_feed_interactions(uuid, uuid[], uuid[], uuid[]) to service_role;
