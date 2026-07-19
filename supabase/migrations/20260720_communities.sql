-- ============================================================
-- Communities: auto-created per city / sector / interest
-- Members: many-to-many user ↔ community
-- Messages: live chat, Supabase Realtime enabled
-- ============================================================

-- ─── communities ────────────────────────────────────────────
create table if not exists communities (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  description  text,
  -- 'city' | 'sector' | 'interest'
  type         text not null check (type in ('city', 'sector', 'interest')),
  -- points to cities.id / design_sectors.id / design_interests.id
  reference_id uuid not null,
  image_url    text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- one community per dimension-value combination
  unique(type, reference_id)
);

create index if not exists idx_communities_type_ref on communities (type, reference_id);

create or replace trigger trg_communities_updated_at
  before update on communities
  for each row execute function set_updated_at();

-- ─── community_members ──────────────────────────────────────
create table if not exists community_members (
  community_id uuid not null references communities (id) on delete cascade,
  user_id      uuid not null references users (id) on delete cascade,
  joined_at    timestamptz not null default now(),
  primary key (community_id, user_id)
);

create index if not exists idx_community_members_user on community_members (user_id);

-- ─── community_messages ─────────────────────────────────────
create table if not exists community_messages (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities (id) on delete cascade,
  user_id      uuid not null references users (id) on delete cascade,
  content      text not null check (char_length(content) between 1 and 2000),
  created_at   timestamptz not null default now()
);

create index if not exists idx_community_messages_room_time
  on community_messages (community_id, created_at asc);

-- ─── RLS ────────────────────────────────────────────────────
-- We use a custom session-cookie auth (not Supabase Auth), so we
-- allow public SELECT for realtime subscriptions. Writes are guarded
-- by the Next.js API routes (service-role key), never client-direct.
alter table communities       enable row level security;
alter table community_members enable row level security;
alter table community_messages enable row level security;

create policy "public_read" on communities        for select using (true);
create policy "public_read" on community_members  for select using (true);
create policy "public_read" on community_messages for select using (true);

-- ─── Realtime ───────────────────────────────────────────────
-- Enables Supabase Realtime INSERT events on community_messages.
-- Run once per Supabase project (safe to re-run — ADD is idempotent).
alter publication supabase_realtime add table community_messages;
