import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { logCommunityActivity, type CommunityPermissions } from "@/lib/communities/manager-role";

const PERMISSION_KEYS = [
  "can_edit_settings",
  "can_manage_members",
  "can_delete_messages",
] as const;

/**
 * PATCH /api/admin/communities/[id]/admins/[userId]
 * Body: { permissions: { can_edit_settings?: boolean, can_manage_members?: boolean, can_delete_messages?: boolean } }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id, userId } = await params;

  let body: { permissions?: Record<string, unknown> };
  try { body = await req.json(); } catch { body = {}; }
  const incoming = body.permissions ?? {};

  const permissions: CommunityPermissions = {
    can_edit_settings:
      typeof incoming.can_edit_settings === "boolean"
        ? incoming.can_edit_settings
        : false,
    can_manage_members:
      typeof incoming.can_manage_members === "boolean"
        ? incoming.can_manage_members
        : false,
    can_delete_messages:
      typeof incoming.can_delete_messages === "boolean"
        ? incoming.can_delete_messages
        : false,
  };
  // Accept partial bodies — untouched toggles keep their current value.
  const untouched = PERMISSION_KEYS.filter((key) => !(key in incoming));

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
      .select("can_edit_settings, can_manage_members, can_delete_messages")
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

  // Fill in untouched keys from the stored row (defaults when absent).
  if (untouched.length) {
    const current = existingPerms
      ? {
          can_edit_settings: existingPerms.can_edit_settings,
          can_manage_members: existingPerms.can_manage_members,
          can_delete_messages: existingPerms.can_delete_messages,
        }
      : undefined;
    for (const key of untouched) {
      permissions[key] = current?.[key] ?? true;
    }
  }

  const { error } = await db
    .from("community_admin_permissions")
    .upsert(
      {
        community_id: id,
        user_id: userId,
        can_edit_settings: permissions.can_edit_settings,
        can_manage_members: permissions.can_manage_members,
        can_delete_messages: permissions.can_delete_messages,
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
