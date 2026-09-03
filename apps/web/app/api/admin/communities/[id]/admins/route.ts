import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { ALL_COMMUNITY_PERMISSIONS, logCommunityActivity } from "@/lib/communities/manager-role";

/**
 * GET /api/admin/communities/[id]/admins
 *
 * Lists the community's appointed admins with their permission grants, plus
 * community meta so the caller knows whether admins apply (app-created only).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;
  const db = createServiceClient();

  const [{ data: community }, { data: memberships }, { data: permsRows }] = await Promise.all([
    db.from("communities").select("id, name, owner_id").eq("id", id).maybeSingle(),
    db
      .from("community_members")
      .select("user_id, joined_at")
      .eq("community_id", id)
      .eq("role", "admin")
      .order("joined_at", { ascending: true }),
    db
      .from("community_admin_permissions")
      .select("community_id, user_id, can_edit_settings, can_manage_members, can_delete_messages, granted_at, granted_by, updated_at")
      .eq("community_id", id),
  ]);

  if (!community) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }

  const adminUserIds = (memberships ?? []).map((m) => m.user_id);
  const { data: userRows } = adminUserIds.length
    ? await db.from("users").select("id, name, email").in("id", adminUserIds)
    : { data: [] };

  const userMap = Object.fromEntries((userRows ?? []).map((u) => [u.id, u]));
  const permsMap = new Map(
    (permsRows ?? []).map((p) => [p.user_id, p]),
  );

  const admins = (memberships ?? []).flatMap((m) => {
    const user = userMap[m.user_id];
    if (!user) return [];
    const perms = permsMap.get(m.user_id) ?? null;
    return [
      {
        user_id: m.user_id,
        name: user.name,
        email: user.email,
        joined_at: m.joined_at,
        permissions: {
          can_edit_settings: perms?.can_edit_settings ?? ALL_COMMUNITY_PERMISSIONS.can_edit_settings,
          can_manage_members: perms?.can_manage_members ?? ALL_COMMUNITY_PERMISSIONS.can_manage_members,
          can_delete_messages: perms?.can_delete_messages ?? ALL_COMMUNITY_PERMISSIONS.can_delete_messages,
        },
        granted_at: perms?.granted_at ?? m.joined_at,
        updated_at: perms?.updated_at ?? null,
      },
    ];
  });

  return NextResponse.json({
    community: { id: community.id, name: community.name, is_app_created: community.owner_id == null },
    admins,
  });
}

/**
 * POST /api/admin/communities/[id]/admins  { user_id }
 *
 * Promotes a member of an app-created community to admin with the default
 * permission set (everything on). Fine-tuning happens on the admin's page.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try { await requireSession("admin"); } catch (e) { return e as Response; }
  const { id } = await params;

  let body: { user_id?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const targetUserId = typeof body.user_id === "string" ? body.user_id : "";
  if (!targetUserId) {
    return NextResponse.json({ error: "user_id is required." }, { status: 422 });
  }

  const db = createServiceClient();

  const { data: community } = await db
    .from("communities")
    .select("id, name, owner_id")
    .eq("id", id)
    .maybeSingle();

  if (!community) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }
  // Admins apply to communities the platform runs (no member owner). Owned
  // communities already have an owner who manages them in the app.
  if (community.owner_id != null) {
    return NextResponse.json(
      { error: "Admins can only be added to app-created communities." },
      { status: 400 },
    );
  }

  const [{ data: membership }, { data: targetUser }] = await Promise.all([
    db
      .from("community_members")
      .select("role")
      .eq("community_id", id)
      .eq("user_id", targetUserId)
      .maybeSingle(),
    db.from("users").select("name").eq("id", targetUserId).maybeSingle(),
  ]);

  if (!membership || !targetUser) {
    return NextResponse.json(
      { error: "That user is not a member of this community." },
      { status: 404 },
    );
  }
  if (membership.role === "owner") {
    return NextResponse.json(
      { error: "Community owners already have full management powers." },
      { status: 400 },
    );
  }
  if (membership.role === "admin") {
    return NextResponse.json(
      { error: "This member is already an admin." },
      { status: 409 },
    );
  }

  // Promote + grant the default permission set (all toggles on).
  const { error: roleError } = await db
    .from("community_members")
    .update({ role: "admin" })
    .eq("community_id", id)
    .eq("user_id", targetUserId);
  if (roleError) {
    console.error("[promote admin]", roleError);
    return NextResponse.json({ error: "Failed to promote member." }, { status: 500 });
  }

  const { error: permsError } = await db
    .from("community_admin_permissions")
    .upsert(
      {
        community_id: id,
        user_id: targetUserId,
        ...ALL_COMMUNITY_PERMISSIONS,
      },
      { onConflict: "community_id,user_id" },
    );
  if (permsError) {
    console.error("[promote admin perms]", permsError);
    return NextResponse.json({ error: "Failed to grant permissions." }, { status: 500 });
  }

  await logCommunityActivity(db, {
    communityId: id,
    actorRole: "platform",
    action: "admin_promoted",
    targetUserId,
    details: { admin_name: targetUser.name },
  });

  return NextResponse.json({
    admin: {
      user_id: targetUserId,
      name: targetUser.name,
      permissions: { ...ALL_COMMUNITY_PERMISSIONS },
    },
  });
}
