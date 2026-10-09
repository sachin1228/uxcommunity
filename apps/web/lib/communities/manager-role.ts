import "server-only";

import type { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/database.types";
import {
  ALL_COMMUNITY_PERMISSIONS,
  NO_COMMUNITY_PERMISSIONS,
  hasAnyCommunityPermission,
  type CommunityPermission,
  type CommunityPermissions,
} from "./permissions";

type Db = ReturnType<typeof createServiceClient>;

/**
 * Who manages a community:
 *  - owners (creator of a member-created community) always hold every capability;
 *  - platform-appointed admins of app-created communities hold whichever
 *    toggles the platform enabled in `community_admin_permissions`;
 *  - moderators, appointed by the manager tier in-app, hold whichever toggles
 *    the appointer picked in the same table.
 *
 * The owner and the app-created community's admin form the manager tier:
 * they appoint, edit and dismiss moderators (an app-created community never
 * has an owner, so its platform-appointed admin stands in for one).
 */
export type CommunityRole = "owner" | "admin" | "moderator" | "member";

export interface CommunityManagerStatus {
  /** The caller's role in the community, or null when they are not a member. */
  role: CommunityRole | null;
  /** Effective permission set (owner ⇒ all true). */
  permissions: CommunityPermissions;
  /** True for the community's owner (creator). */
  isOwner: boolean;
  /**
   * True when the caller may appoint, edit and dismiss moderators: the owner,
   * or the platform-appointed admin of an app-created community (which never
   * has an owner). Admins only exist in app-created communities — the platform
   * is the only writer of `role = 'admin'`.
   */
  canManageModerators: boolean;
  /** True when the caller may take at least one management action. */
  canManage: boolean;
}

/**
 * The caller's role within a community, resolved from the community's owner
 * id and their membership row. Shared by the manager-status loader and the
 * community read model so both agree on what a membership means.
 */
export function resolveCommunityRole(
  communityOwnerId: string | null | undefined,
  membershipRole: string | null | undefined,
  userId: string,
): CommunityRole {
  if (communityOwnerId === userId || membershipRole === "owner") return "owner";
  if (membershipRole === "admin") return "admin";
  if (membershipRole === "moderator") return "moderator";
  return "member";
}

/**
 * Effective permission set for a role. Owners hold everything; members hold
 * nothing; admins and moderators read their granted row. A missing row means
 * the grant was never written (or was lost mid-flow): admins keep their
 * historically permissive default, moderators get nothing — a half-applied
 * promotion must never hand out powers the owner did not pick.
 */
export async function loadCommunityPermissions(
  db: Db,
  communityId: string,
  userId: string,
  role: CommunityRole,
): Promise<CommunityPermissions> {
  if (role === "owner") return ALL_COMMUNITY_PERMISSIONS;
  if (role === "member") return NO_COMMUNITY_PERMISSIONS;

  const { data: perms } = await db
    .from("community_admin_permissions")
    .select(
      "can_edit_settings, can_manage_members, can_delete_messages, can_moderate_threads, can_moderate_showcase, can_moderate_resources, can_moderate_events",
    )
    .eq("community_id", communityId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!perms) return role === "admin" ? ALL_COMMUNITY_PERMISSIONS : NO_COMMUNITY_PERMISSIONS;

  return {
    can_edit_settings: perms.can_edit_settings,
    can_manage_members: perms.can_manage_members,
    can_delete_messages: perms.can_delete_messages,
    can_moderate_threads: perms.can_moderate_threads,
    can_moderate_showcase: perms.can_moderate_showcase,
    can_moderate_resources: perms.can_moderate_resources,
    can_moderate_events: perms.can_moderate_events,
  };
}

/**
 * Loads the caller's membership role + effective permission set for a
 * community in one place so every mutation route enforces the same rules.
 */
export async function loadCommunityManagerStatus(
  db: Db,
  communityId: string,
  userId: string,
): Promise<CommunityManagerStatus | null> {
  const [{ data: community }, { data: membership }] = await Promise.all([
    db
      .from("communities")
      .select("owner_id")
      .eq("id", communityId)
      .eq("is_active", true)
      .maybeSingle(),
    db
      .from("community_members")
      .select("role")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (!community) return null;
  if (!membership) {
    return {
      role: null,
      permissions: NO_COMMUNITY_PERMISSIONS,
      isOwner: false,
      canManageModerators: false,
      canManage: false,
    };
  }

  const role = resolveCommunityRole(community.owner_id, membership.role, userId);
  const permissions = await loadCommunityPermissions(db, communityId, userId, role);

  return {
    role,
    permissions,
    isOwner: role === "owner",
    canManageModerators: role === "owner" || role === "admin",
    canManage: role === "owner" || hasAnyCommunityPermission(permissions),
  };
}

/**
 * Permission gate for content moderation: whether the caller is the owner or
 * holds `permission`, plus the loaded status so callers can record the actor
 * role in the audit trail.
 */
export async function loadCommunityPermissionCheck(
  db: Db,
  communityId: string,
  userId: string,
  permission: CommunityPermission,
): Promise<{ allowed: boolean; status: CommunityManagerStatus | null }> {
  const status = await loadCommunityManagerStatus(db, communityId, userId);
  const allowed = Boolean(status && (status.isOwner || status.permissions[permission]));
  return { allowed, status };
}

/** The actor_role recorded in the activity trail for a manager's action. */
export function managerActorRole(
  status: CommunityManagerStatus,
): "owner" | "admin" | "moderator" {
  if (status.role === "owner") return "owner";
  return status.role === "moderator" ? "moderator" : "admin";
}

export interface ActivityEntry {
  communityId: string;
  /** App user who performed the action. Null for platform-level actions. */
  actorId?: string | null;
  actorRole: "owner" | "admin" | "moderator" | "platform";
  /** Display-name snapshot (also used for platform actions when available). */
  actorName?: string | null;
  action: string;
  targetUserId?: string | null;
  /** Arbitrary JSON stored on the activity row (see the `details` column). */
  details?: Json;
}

/**
 * Appends one row to the community activity audit trail. Best-effort: callers
 * fire this after the main mutation so a logging failure never fails the
 * mutation itself. The actor's name is snapshotted (fetched when the caller
 * did not already provide it) so the trail survives renames / deletions.
 */
export async function logCommunityActivity(
  db: Db,
  entry: ActivityEntry,
): Promise<void> {
  try {
    let actorName = entry.actorName ?? null;
    if (!actorName && entry.actorId) {
      const { data: actor } = await db.from("users").select("name").eq("id", entry.actorId).maybeSingle();
      actorName = actor?.name ?? null;
    }

    await db.from("community_admin_activity").insert({
      community_id: entry.communityId,
      actor_id: entry.actorId ?? null,
      actor_role: entry.actorRole,
      actor_name: actorName,
      action: entry.action,
      target_user_id: entry.targetUserId ?? null,
      details: entry.details ?? {},
    });
  } catch (error) {
    console.error("[community-activity] failed to write activity log:", error);
  }
}
