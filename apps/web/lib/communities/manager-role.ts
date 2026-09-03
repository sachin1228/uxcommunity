import "server-only";

import type { createServiceClient } from "@/lib/supabase/service";

type Db = ReturnType<typeof createServiceClient>;

/**
 * Community "management" capabilities granted to community members.
 *
 * Owners (creator of a member-created community) always hold every capability.
 * Platform-appointed admins of app-created communities hold whichever of the
 * three toggles the platform enabled in `community_admin_permissions`.
 */
export type CommunityPermission = "can_edit_settings" | "can_manage_members" | "can_delete_messages";

export interface CommunityPermissions {
  can_edit_settings: boolean;
  can_manage_members: boolean;
  can_delete_messages: boolean;
}

export type CommunityRole = "owner" | "admin" | "member";

export const ALL_COMMUNITY_PERMISSIONS: CommunityPermissions = {
  can_edit_settings: true,
  can_manage_members: true,
  can_delete_messages: true,
};

export const NO_COMMUNITY_PERMISSIONS: CommunityPermissions = {
  can_edit_settings: false,
  can_manage_members: false,
  can_delete_messages: false,
};

export interface CommunityManagerStatus {
  /** The caller's role in the community, or null when they are not a member. */
  role: CommunityRole | null;
  /** Effective permission set (owner ⇒ all true). */
  permissions: CommunityPermissions;
  /** True for the community's owner (creator). */
  isOwner: boolean;
  /** True when the caller may take at least one management action. */
  canManage: boolean;
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
      canManage: false,
    };
  }

  const isOwner = community.owner_id === userId || membership.role === "owner";
  const role: CommunityRole = isOwner ? "owner" : (membership.role === "admin" ? "admin" : "member");

  if (role === "owner") {
    return {
      role,
      permissions: ALL_COMMUNITY_PERMISSIONS,
      isOwner: true,
      canManage: true,
    };
  }

  if (role === "admin") {
    const { data: perms } = await db
      .from("community_admin_permissions")
      .select("can_edit_settings, can_manage_members, can_delete_messages")
      .eq("community_id", communityId)
      .eq("user_id", userId)
      .maybeSingle();

    const permissions: CommunityPermissions = perms
      ? {
          can_edit_settings: perms.can_edit_settings,
          can_manage_members: perms.can_manage_members,
          can_delete_messages: perms.can_delete_messages,
        }
      : ALL_COMMUNITY_PERMISSIONS;

    return {
      role,
      permissions,
      isOwner: false,
      canManage:
        permissions.can_edit_settings ||
        permissions.can_manage_members ||
        permissions.can_delete_messages,
    };
  }

  return { role: "member", permissions: NO_COMMUNITY_PERMISSIONS, isOwner: false, canManage: false };
}

/** Shorthand used by server read models when serialising the community meta. */
export function permissionsToClient(
  role: CommunityRole | null,
  permissions: CommunityPermissions,
): CommunityPermissions {
  if (role === "owner") return ALL_COMMUNITY_PERMISSIONS;
  if (role === "admin") return permissions;
  return NO_COMMUNITY_PERMISSIONS;
}

export interface ActivityEntry {
  communityId: string;
  /** App user who performed the action. Null for platform-level actions. */
  actorId?: string | null;
  actorRole: "owner" | "admin" | "platform";
  /** Display-name snapshot (also used for platform actions when available). */
  actorName?: string | null;
  action: string;
  targetUserId?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Appends one row to the community activity audit trail. Best-effort: callers
 * fire this after the main mutation so a logging failure never fails the
 * mutation itself.
 */
export async function logCommunityActivity(
  db: Db,
  entry: ActivityEntry,
): Promise<void> {
  try {
    await db.from("community_admin_activity").insert({
      community_id: entry.communityId,
      actor_id: entry.actorId ?? null,
      actor_role: entry.actorRole,
      actor_name: entry.actorName ?? null,
      action: entry.action,
      target_user_id: entry.targetUserId ?? null,
      details: entry.details ?? {},
    });
  } catch (error) {
    console.error("[community-activity] failed to write activity log:", error);
  }
}
