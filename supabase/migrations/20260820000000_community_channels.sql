-- ============================================================
-- Community channels (subchannels)
--
-- Lets the owner of a user-created community organise chat into
-- named subchannels (Discord-style). Each channel has its own
-- message thread; community_messages.channel_id points at it,
-- NULL meaning the community's default "general" chat.
-- Writes go through the Next.js API (custom cookie sessions).
-- ============================================================

create table if not exists community_channels (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities (id) on delete cascade,
  created_by   uuid not null references users (id) on delete cascade,
  name         varchar(80) not null check (char_length(name) between 1 and 80),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (community_id, lower(name))
);

create index if not exists idx_community_channels_community_time
  on community_channels (community_id, created_at asc);

create or replace trigger trg_community_channels_updated_at
  before update on community_channels
  for each row execute function set_updated_at();

alter table community_channels enable row level security;

create policy "public_read" on community_channels
  for select using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'community_channels'
  ) then
    alter publication supabase_realtime add table community_channels;
  end if;
end $$;

alter table community_channels replica identity full;

-- ─── Scope messages to a channel ──────────────────────────────────
alter table community_messages
  add column if not exists channel_id uuid
  references community_channels (id) on delete cascade;

create index if not exists idx_community_messages_channel_time
  on community_messages (community_id, channel_id, created_at asc);