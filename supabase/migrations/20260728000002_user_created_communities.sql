-- ============================================================
-- User-created communities
--
-- Extends the existing communities model so self-serve public/private
-- communities use the same chat, threads, events, resources, and sidebar
-- infrastructure as profile/admin-created communities.
-- ============================================================

alter table communities
  drop constraint if exists communities_type_check;

alter table communities
  add constraint communities_type_check
  check (type in ('city', 'sector', 'interest', 'company', 'experience_level', 'general', 'user'));

alter table communities
  add column if not exists owner_id uuid references users(id) on delete set null,
  add column if not exists is_private boolean not null default false,
  add column if not exists invite_token text not null default replace(gen_random_uuid()::text, '-', ''),
  add column if not exists enabled_tabs text[] not null default array['chat', 'threads', 'events', 'resources'];

alter table communities
  add constraint communities_enabled_tabs_check
  check (
    enabled_tabs <@ array['chat', 'threads', 'events', 'resources']
    and 'chat' = any(enabled_tabs)
  );

create index if not exists idx_communities_owner
  on communities (owner_id)
  where owner_id is not null;

create unique index if not exists idx_communities_invite_token
  on communities (invite_token);

alter table community_members
  add column if not exists role text not null default 'member';

alter table community_members
  add constraint community_members_role_check
  check (role in ('owner', 'member'));

create index if not exists idx_community_members_role
  on community_members (community_id, role);

create table if not exists community_join_requests (
  id             uuid primary key default gen_random_uuid(),
  community_id   uuid not null references communities(id) on delete cascade,
  user_id        uuid not null references users(id) on delete cascade,
  status         text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  requested_at   timestamptz not null default now(),
  decided_at     timestamptz,
  decided_by     uuid references users(id) on delete set null,
  unique (community_id, user_id)
);

create index if not exists idx_community_join_requests_community_status
  on community_join_requests (community_id, status, requested_at desc);

alter table community_join_requests enable row level security;

create policy "public_read" on community_join_requests
  for select using (true);
