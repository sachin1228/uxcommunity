import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { loadCommunityManagerStatus, logCommunityActivity } from "@/lib/communities/manager-role";

/**
 * Strip year-range suffixes and singularize experience level names for display.
 * e.g. "Mid-Level Designers (3-5 years)" → "Mid-Level Designer"
 *      "Heads of Design"                 → "Head of Design"
 */
function cleanDesignation(name: string): string {
  const clean = name.split("(")[0].trim();
  if (/^heads\s+of\b/i.test(clean)) return clean.replace(/^heads/i, "Head");
  if (clean.endsWith("s") && clean.length > 1) return clean.slice(0, -1);
  return clean;
}

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
 * Owner (or a community admin holding the "manage members" permission) removes
 * a member from the community. Admins may remove regular members only; the
 * owner may remove anyone except themselves (use leave instead).
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
  const isAdmin =
    managerStatus.role === "admin" && managerStatus.permissions.can_manage_members;
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "Owner or community admin only." }, { status: 403 });
  }
  if (targetUserId === callerId) {
    return NextResponse.json(
      { error: isOwner ? "Owner cannot remove themselves." : "Admins cannot remove themselves." },
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
  if (!isOwner && targetRole === "admin") {
    return NextResponse.json(
      { error: "Only the owner can remove another admin." },
      { status: 403 },
    );
  }

  // Remove membership + any admin permission grants in one go.
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
    actorRole: isOwner ? "owner" : "admin",
    action: "member_removed",
    targetUserId,
    details: { member_name: targetUser?.name ?? null },
  });

  return NextResponse.json({ success: true });
}
