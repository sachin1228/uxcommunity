import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { logCommunityActivity } from "@/lib/communities/manager-role";
import {
  ALL_COMMUNITY_PERMISSIONS,
  applyCommunityPermissionPatch,
  type CommunityPermissions,
} from "@/lib/communities/permissions";

/**
 * PATCH /api/admin/communities/[id]/admins/[userId]
 * Body: { permissions: { <any subset of the permission toggles>: boolean } }
 * Partial bodies are accepted — untouched toggles keep their stored value.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id, userId } = await params;

  let body: { permissions?: unknown };
  try { body = await req.json(); } catch { body = {}; }

  const db = createServiceClient();

  const [{ data: community }, { data: membership }, { data: existingPerms }] = await Promise.all([
    db.from("communities").select("id, name, owner_id").eq("id", id).maybeSingle(),
    db
      .from("community_members")
      .select("role")
      .eq("community_id", id)
      .eq("user_id", userId)
      .maybeSingle(),
    db
      .from("community_admin_permissions")
      .select(
        "can_edit_settings, can_manage_members, can_delete_messages, can_moderate_threads, can_moderate_showcase, can_moderate_resources, can_moderate_events",
      )
      .eq("community_id", id)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (!community) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }
  if (!membership || membership.role !== "admin") {
    return NextResponse.json({ error: "This user is not an admin of this community." }, { status: 404 });
  }

  // Untouched toggles keep the stored row (defaults to everything-on when no
  // row exists, matching the promote flow).
  const base: CommunityPermissions = existingPerms
    ? {
        can_edit_settings: existingPerms.can_edit_settings,
        can_manage_members: existingPerms.can_manage_members,
        can_delete_messages: existingPerms.can_delete_messages,
        can_moderate_threads: existingPerms.can_moderate_threads,
        can_moderate_showcase: existingPerms.can_moderate_showcase,
        can_moderate_resources: existingPerms.can_moderate_resources,
        can_moderate_events: existingPerms.can_moderate_events,
      }
    : ALL_COMMUNITY_PERMISSIONS;

  const permissions = applyCommunityPermissionPatch(base, body.permissions ?? {});
  if (!permissions) {
    return NextResponse.json(
      { error: "permissions must be an object with boolean toggles." },
      { status: 422 },
    );
  }

  const { error } = await db
    .from("community_admin_permissions")
    .upsert(
      {
        community_id: id,
        user_id: userId,
        ...permissions,
      },
      { onConflict: "community_id,user_id" },
    );

  if (error) {
    console.error("[admin permissions]", error);
    return NextResponse.json({ error: "Failed to update permissions." }, { status: 500 });
  }

  const { data: targetUser } = await db.from("users").select("name").eq("id", userId).maybeSingle();
  await logCommunityActivity(db, {
    communityId: id,
    actorRole: "platform",
    action: "admin_permissions_updated",
    targetUserId: userId,
    details: {
      admin_name: targetUser?.name ?? null,
      permissions: { ...permissions },
    },
  });

  return NextResponse.json({ permissions });
}

/**
 * DELETE /api/admin/communities/[id]/admins/[userId]
 * Revokes admin rights — the user stays a regular member.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id, userId } = await params;
  const db = createServiceClient();

  const [{ data: community }, { data: membership }, { data: targetUser }] = await Promise.all([
    db.from("communities").select("id, name").eq("id", id).maybeSingle(),
    db
      .from("community_members")
      .select("role")
      .eq("community_id", id)
      .eq("user_id", userId)
      .maybeSingle(),
    db.from("users").select("name").eq("id", userId).maybeSingle(),
  ]);

  if (!community) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }
  if (!membership || membership.role !== "admin") {
    return NextResponse.json({ error: "This user is not an admin of this community." }, { status: 404 });
  }

  const [roleResult, permsResult] = await Promise.all([
    db
      .from("community_members")
      .update({ role: "member" })
      .eq("community_id", id)
      .eq("user_id", userId),
    db
      .from("community_admin_permissions")
      .delete()
      .eq("community_id", id)
      .eq("user_id", userId),
  ]);

  if (roleResult.error || permsResult.error) {
    console.error("[demote admin]", roleResult.error ?? permsResult.error);
    return NextResponse.json({ error: "Failed to remove admin rights." }, { status: 500 });
  }

  await logCommunityActivity(db, {
    communityId: id,
    actorRole: "platform",
    action: "admin_demoted",
    targetUserId: userId,
    details: { admin_name: targetUser?.name ?? null },
  });

  return NextResponse.json({ success: true });
}
