-- ============================================================
-- Community moderators
--
-- Lets the owner of a member-created community appoint members as
-- moderators, in-app, with a granular set of powers: chat, threads,
-- showcase, resources, events, member management, and settings.
-- Platform-appointed admins keep their existing flow; both roles read
-- the same permission table (community_admin_permissions), so one
-- helper enforces both.
-- ============================================================

-- ─── community_members.role now supports 'moderator' ────────────────────────
-- Owners are the member who created the community; admins are appointed by
-- the platform; moderators are appointed by the community's owner in the app.
alter table community_members
  drop constraint if exists community_members_role_check;

alter table community_members
  add constraint community_members_role_check
  check (role in ('owner', 'admin', 'moderator', 'member'));

-- ─── Per-area moderation grants ─────────────────────────────────────────────
-- The three original toggles cover settings / membership / chat. Moderators
-- (and, going forward, admins) can additionally hold per-area content
-- moderation. Defaults stay permissive so rows that predate this migration
-- keep a platform admin's owner-style reach; the in-app promote flow writes
-- the owner's chosen subset explicitly.
alter table community_admin_permissions
  add column if not exists can_moderate_threads   boolean not null default true,
  add column if not exists can_moderate_showcase  boolean not null default true,
  add column if not exists can_moderate_resources boolean not null default true,
  add column if not exists can_moderate_events    boolean not null default true;

-- ─── Activity log accepts moderator actors ──────────────────────────────────
alter table community_admin_activity
  drop constraint if exists community_admin_activity_actor_role_check;

alter table community_admin_activity
  add constraint community_admin_activity_actor_role_check
  check (actor_role in ('owner', 'admin', 'moderator', 'platform'));
