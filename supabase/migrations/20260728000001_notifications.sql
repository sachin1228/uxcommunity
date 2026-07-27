-- ============================================================
-- User notifications
--
-- Persisted notifications power the dashboard bell and are broadcast
-- through Supabase Realtime. Writes go through the Next.js API/service role.
-- ============================================================

create table if not exists notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  actor_id     uuid references users (id) on delete set null,
  community_id uuid references communities (id) on delete cascade,
  type         text not null check (
    type in (
      'community_thread',
      'community_resource',
      'community_event',
      'thread_comment',
      'thread_reply',
      'thread_vote',
      'thread_save',
      'resource_comment',
      'resource_reply',
      'resource_save',
      'resource_bookmark',
      'event_comment',
      'event_reply',
      'event_rsvp',
      'event_save'
    )
  ),
  entity_type  text not null check (entity_type in ('community', 'thread', 'resource', 'event')),
  entity_id    uuid not null,
  title        varchar(160) not null,
  body         text,
  href         text not null,
  metadata     jsonb not null default '{}'::jsonb,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists idx_notifications_user_created
  on notifications (user_id, created_at desc);

create index if not exists idx_notifications_user_unread
  on notifications (user_id, created_at desc)
  where read_at is null;

create index if not exists idx_notifications_entity
  on notifications (entity_type, entity_id);

alter table notifications enable row level security;

-- The app uses custom cookie auth instead of Supabase Auth; reads still go
-- through server APIs. This select policy allows browser realtime filters to
-- receive rows for live updates.
create policy "public_read" on notifications
  for select using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table notifications;
  end if;
end $$;

alter table notifications replica identity full;
