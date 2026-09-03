-- ============================================================
-- Community admins & moderation activity
--
-- Lets the platform (admin dashboard) appoint members of app-created
-- communities as community admins with granular permissions, and records an
-- audit trail of every management action taken in a community so the owner /
-- platform can track what each admin does.
-- ============================================================

-- ─── community_members.role now supports 'admin' ───────────────────────────
-- Owners are the member who created the community; admins are appointed by the
-- platform (or, historically, future flows) and manage the community in-app.
alter table community_members
  drop constraint if exists community_members_role_check;

alter table community_members
  add constraint community_members_role_check
  check (role in ('owner', 'admin', 'member'));

-- ─── Per-admin permission grants ────────────────────────────────────────────
-- One row per (community, admin). Defaults are intentionally permissive so a
-- freshly promoted admin immediately gets owner-style management powers in the
-- app; the platform can then trim individual toggles on the admin's page.
create table if not exists community_admin_permissions (
  community_id        uuid    not null references communities (id) on delete cascade,
  user_id             uuid    not null references users (id) on delete cascade,
  -- Rename / description / photo / rules / tabs / invite-link regeneration.
  can_edit_settings   boolean not null default true,
  -- Remove members + approve/decline join requests.
  can_manage_members  boolean not null default true,
  -- Delete any member's chat messages (moderation).
  can_delete_messages boolean not null default true,
  granted_at          timestamptz not null default now(),
  granted_by          uuid    references users (id) on delete set null,
  updated_at          timestamptz not null default now(),
  primary key (community_id, user_id)
);

create or replace trigger trg_community_admin_permissions_updated_at
  before update on community_admin_permissions
  for each row execute function public.set_updated_at();

-- Read/write through the service-role client / admin API only. The app never
-- reads these rows directly (permissions ride along with the community read
-- model), so no public policy is needed.
alter table community_admin_permissions enable row level security;

-- ─── Activity / audit log ───────────────────────────────────────────────────
-- One row per management action taken in a community by a community admin /
-- owner or by the platform itself (promotions, demotions, permission edits).
-- actor_name is snapshotted so the trail survives user renames / deletions.
create table if not exists community_admin_activity (
  id              uuid primary key default gen_random_uuid(),
  community_id    uuid not null references communities (id) on delete cascade,
  actor_id        uuid references users (id) on delete set null,
  actor_role      text not null default 'admin'
                  check (actor_role in ('owner', 'admin', 'platform')),
  actor_name      text,
  action          text not null,
  target_user_id  uuid references users (id) on delete set null,
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_community_admin_activity_community
  on community_admin_activity (community_id, created_at desc);

create index if not exists idx_community_admin_activity_actor
  on community_admin_activity (community_id, actor_id, created_at desc);

-- Read through the admin API only (service role bypasses RLS).
alter table community_admin_activity enable row level security;
