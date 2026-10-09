import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import {
  loadCommunityManagerStatus,
  loadCommunityPermissions,
  logCommunityActivity,
  managerActorRole,
} from "@/lib/communities/manager-role";
import {
  MODERATOR_DEFAULT_PERMISSIONS,
  applyCommunityPermissionPatch,
} from "@/lib/communities/permissions";
import { cleanDesignation } from "@/lib/communities/comment-authors";

/**
 * GET /api/communities/[id]/members/[userId]
 *
 * Lightweight endpoint used by CommunityChat to lazily resolve the display
 * info (name + avatar) of a message sender who is not yet in the local
 * members cache.  Requires the *calling* user to be a member of the community.
 *
 * Returns: { name: string, avatar_url: string | null }
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const callerId = session.userId!;
  const { id: communityId, userId } = await params;

  const db = createServiceClient();

  // Verify the calling user is a member of this community (auth guard).
  const { data: membership } = await db
    .from("community_members")
    .select("user_id")
    .eq("community_id", communityId)
    .eq("user_id", callerId)
    .maybeSingle();

  if (!membership) {
    return NextResponse.json({ error: "Not a member." }, { status: 403 });
  }

  // Fetch name + avatar + designation in parallel.
  const [{ data: user }, { data: profile }] = await Promise.all([
    db.from("users").select("name").eq("id", userId).maybeSingle(),
    db.from("designer_profiles").select("avatar_url, experience_level").eq("user_id", userId).maybeSingle(),
  ]);

  if (!user) {
    return NextResponse.json({ error: "User not found." }, { status: 404 });
  }

  // Resolve experience level display name from slug.
  let designation: string | null = null;
  const expSlug = (profile as any)?.experience_level ?? null;
  if (expSlug) {
    const { data: expLevel } = await db
      .from("experience_levels")
      .select("name")
      .eq("slug", expSlug)
      .maybeSingle();
    designation = expLevel?.name ? cleanDesignation(expLevel.name) : null;
  }

  return NextResponse.json({
    name: user.name,
    avatar_url: profile?.avatar_url ?? null,
    designation,
  });
}

/**
 * DELETE /api/communities/[id]/members/[userId]
 *
 * Owner (or a community admin / moderator holding the "manage members"
 * permission) removes a member from the community. The owner — and the
 * platform-appointed admin of an app-created community — may also remove a
 * moderator; platform-appointed admins themselves are managed by the platform.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const callerId = session.userId!;
  const { id: communityId, userId: targetUserId } = await params;
  const db = createServiceClient();

  const managerStatus = await loadCommunityManagerStatus(db, communityId, callerId);
  if (!managerStatus) return NextResponse.json({ error: "Community not found." }, { status: 404 });
  const isOwner = managerStatus.isOwner;
  const canRemoveMembers = isOwner || managerStatus.permissions.can_manage_members;
  if (!canRemoveMembers) {
    return NextResponse.json({ error: "You don't have permission to remove members." }, { status: 403 });
  }
  if (targetUserId === callerId) {
    return NextResponse.json(
      { error: isOwner ? "Owner cannot remove themselves." : "Leave the community instead of removing yourself." },
      { status: 400 },
    );
  }

  // Target member (role + display name) — used for protection + audit trail.
  const [{ data: targetMembership }, { data: targetUser }] = await Promise.all([
    db
      .from("community_members")
      .select("role")
      .eq("community_id", communityId)
      .eq("user_id", targetUserId)
      .maybeSingle(),
    db.from("users").select("name").eq("id", targetUserId).maybeSingle(),
  ]);
  if (!targetMembership) return NextResponse.json({ error: "Member not found." }, { status: 404 });

  const targetRole = targetMembership.role ?? "member";
  if (targetRole === "owner") {
    return NextResponse.json({ error: "Owners cannot be removed." }, { status: 400 });
  }
  if (targetRole === "admin" && !isOwner) {
    return NextResponse.json(
      { error: "Platform admins are managed by the platform." },
      { status: 400 },
    );
  }
  if (targetRole === "moderator" && !managerStatus.canManageModerators) {
    return NextResponse.json(
      { error: "Only the community owner or an admin can remove a moderator." },
      { status: 403 },
    );
  }

  // Remove membership + any permission grants in one go.
  await db
    .from("community_admin_permissions")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", targetUserId);

  const { error } = await db
    .from("community_members")
    .delete()
    .eq("community_id", communityId)
    .eq("user_id", targetUserId);

  if (error) return NextResponse.json({ error: "Failed to remove member." }, { status: 500 });

  await logCommunityActivity(db, {
    communityId,
    actorId: callerId,
    actorRole: managerActorRole(managerStatus),
    action: "member_removed",
    targetUserId,
    details: { member_name: targetUser?.name ?? null },
  });

  return NextResponse.json({ success: true });
}

/**
 * PATCH /api/communities/[id]/members/[userId]
 *
 * Moderator management by the community's manager tier — the owner, or the
 * platform-appointed admin of an app-created community (which never has an
 * owner):
 *  - { role: "moderator", permissions? } promotes a member (or re-applies an
 *    existing moderator's grants). Omitted permissions default to the
 *    moderator set — content moderation on, administration off.
 *  - { role: "member" } dismisses a moderator back to a regular member.
 *
 * Platform-appointed admins are managed by the platform, never from here.
 */
export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const callerId = session.userId!;
  const { id: communityId, userId: targetUserId } = await params;
  const db = createServiceClient();

  const managerStatus = await loadCommunityManagerStatus(db, communityId, callerId);
  if (!managerStatus) return NextResponse.json({ error: "Community not found." }, { status: 404 });
  if (!managerStatus.canManageModerators) {
    return NextResponse.json(
      { error: "Only the community owner or an admin can manage moderators." },
      { status: 403 },
    );
  }

  let body: { role?: unknown; permissions?: unknown };
  try { body = await _req.json(); } catch { body = {}; }
  const role = body.role;
  if (role !== "moderator" && role !== "member") {
    return NextResponse.json(
      { error: 'role must be "moderator" or "member".' },
      { status: 422 },
    );
  }

  const [{ data: targetMembership }, { data: targetUser }] = await Promise.all([
    db
      .from("community_members")
      .select("role")
      .eq("community_id", communityId)
      .eq("user_id", targetUserId)
      .maybeSingle(),
    db.from("users").select("name").eq("id", targetUserId).maybeSingle(),
  ]);
  if (!targetMembership) return NextResponse.json({ error: "Member not found." }, { status: 404 });

  const targetRole = targetMembership.role ?? "member";
  if (targetRole === "owner") {
    return NextResponse.json({ error: "The owner already has full control." }, { status: 400 });
  }
  if (targetRole === "admin") {
    return NextResponse.json({ error: "Platform admins are managed by the platform." }, { status: 400 });
  }

  // ── Dismiss a moderator ────────────────────────────────────────────────────
  if (role === "member") {
    if (targetRole !== "moderator") {
      return NextResponse.json({ error: "This member is not a moderator." }, { status: 409 });
    }

    const [roleResult, permsResult] = await Promise.all([
      db
        .from("community_members")
        .update({ role: "member" })
        .eq("community_id", communityId)
        .eq("user_id", targetUserId),
      db
        .from("community_admin_permissions")
        .delete()
        .eq("community_id", communityId)
        .eq("user_id", targetUserId),
    ]);

    if (roleResult.error || permsResult.error) {
      console.error("[dismiss moderator]", roleResult.error ?? permsResult.error);
      return NextResponse.json({ error: "Failed to dismiss moderator." }, { status: 500 });
    }

    await logCommunityActivity(db, {
      communityId,
      actorId: callerId,
      actorRole: managerActorRole(managerStatus),
      action: "moderator_dismissed",
      targetUserId,
      details: { member_name: targetUser?.name ?? null },
    });

    return NextResponse.json({ member: { user_id: targetUserId, role: "member", permissions: null } });
  }

  // ── Promote / update grants ────────────────────────────────────────────────
  const wasModerator = targetRole === "moderator";
  const base = wasModerator
    ? await loadCommunityPermissions(db, communityId, targetUserId, "moderator")
    : MODERATOR_DEFAULT_PERMISSIONS;
  const permissions = body.permissions === undefined
    ? base
    : applyCommunityPermissionPatch(base, body.permissions);
  if (!permissions) {
    return NextResponse.json(
      { error: "permissions must be an object with boolean toggles." },
      { status: 422 },
    );
  }

  // Grants first, role second: a failure in between leaves a regular member
  // with an inert grant row — never a moderator whose powers were never saved.
  const { error: permsError } = await db
    .from("community_admin_permissions")
    .upsert(
      {
        community_id: communityId,
        user_id: targetUserId,
        granted_by: callerId,
        ...permissions,
      },
      { onConflict: "community_id,user_id" },
    );
  if (permsError) {
    console.error("[promote moderator perms]", permsError);
    return NextResponse.json({ error: "Failed to save moderator permissions." }, { status: 500 });
  }

  if (!wasModerator) {
    const { error: roleError } = await db
      .from("community_members")
      .update({ role: "moderator" })
      .eq("community_id", communityId)
      .eq("user_id", targetUserId);
    if (roleError) {
      console.error("[promote moderator role]", roleError);
      return NextResponse.json({ error: "Failed to promote member." }, { status: 500 });
    }
  }

  await logCommunityActivity(db, {
    communityId,
    actorId: callerId,
    actorRole: managerActorRole(managerStatus),
    action: wasModerator ? "moderator_permissions_updated" : "moderator_promoted",
    targetUserId,
    details: { member_name: targetUser?.name ?? null, permissions },
  });

  return NextResponse.json({
    member: { user_id: targetUserId, role: "moderator", permissions },
  });
}
