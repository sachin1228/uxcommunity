-- ============================================================
-- Community threads
--
-- A thread is a top-level discussion created inside a community.
-- Writes go through the Next.js API because this app uses custom
-- cookie sessions rather than Supabase Auth.
-- ============================================================

create table if not exists community_threads (
  id             uuid primary key default gen_random_uuid(),
  community_id   uuid not null references communities (id) on delete cascade,
  user_id        uuid not null references users (id) on delete cascade,
  title          varchar(120) not null check (char_length(title) between 1 and 120),
  description    text not null check (char_length(description) between 1 and 10000),
  category       text not null check (
    category in (
      'question',
      'discussion',
      'showcase',
      'resource',
      'idea',
      'feedback',
      'job',
      'collaboration'
    )
  ),
  tags           text[] not null default '{}',
  attachments    jsonb not null default '[]'::jsonb check (jsonb_typeof(attachments) = 'array'),
  links          text[] not null default '{}',
  allow_replies boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_community_threads_community_time
  on community_threads (community_id, created_at desc);

create index if not exists idx_community_threads_user_time
  on community_threads (user_id, created_at desc);

create or replace trigger trg_community_threads_updated_at
  before update on community_threads
  for each row execute function set_updated_at();

alter table community_threads enable row level security;

create policy "public_read" on community_threads
  for select using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'community_threads'
  ) then
    alter publication supabase_realtime add table community_threads;
  end if;
end $$;

alter table community_threads replica identity full;