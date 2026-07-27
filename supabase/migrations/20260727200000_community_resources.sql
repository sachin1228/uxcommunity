-- ============================================================
-- Community resources
--
-- A resource is a curated link/asset that a member shares with
-- their community: Figma files, articles, tools, videos, etc.
-- Writes go through the Next.js API (custom cookie sessions).
-- ============================================================

create table if not exists community_resources (
  id             uuid primary key default gen_random_uuid(),
  community_id   uuid not null references communities (id) on delete cascade,
  user_id        uuid not null references users (id) on delete cascade,
  title          varchar(120) not null check (char_length(title) between 1 and 120),
  description    text check (description is null or char_length(description) <= 2000),
  resource_type  text not null check (
    resource_type in (
      'figma',
      'article',
      'tool',
      'video',
      'book',
      'font',
      'icon_pack',
      'color',
      'template',
      'inspiration',
      'other'
    )
  ),
  url            text not null check (char_length(url) between 1 and 2048),
  tags           text[] not null default '{}',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_community_resources_community_time
  on community_resources (community_id, created_at desc);

create index if not exists idx_community_resources_user_time
  on community_resources (user_id, created_at desc);

create or replace trigger trg_community_resources_updated_at
  before update on community_resources
  for each row execute function set_updated_at();

alter table community_resources enable row level security;

create policy "public_read" on community_resources
  for select using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'community_resources'
  ) then
    alter publication supabase_realtime add table community_resources;
  end if;
end $$;

alter table community_resources replica identity full;
