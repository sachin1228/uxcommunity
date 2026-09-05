import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { loadCommunityManagerStatus, logCommunityActivity } from "@/lib/communities/manager-role";

/**
 * POST /api/communities/[id]/requests/[requestId]/accept
 * Accept a pending join request. Owner or admin with "manage members".
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: communityId, requestId } = await params;
  const db = createServiceClient();

  const managerStatus = await loadCommunityManagerStatus(db, communityId, userId);
  if (!managerStatus) return NextResponse.json({ error: "Community not found." }, { status: 404 });
  const canDecideRequests =
    managerStatus.isOwner ||
    (managerStatus.role === "admin" && managerStatus.permissions.can_manage_members);
  if (!canDecideRequests) {
    return NextResponse.json({ error: "Owner or community admin only." }, { status: 403 });
  }

  const { data: request } = await db
    .from("community_join_requests")
    .select("id, user_id, status")
    .eq("id", requestId)
    .eq("community_id", communityId)
    .maybeSingle();

  if (!request) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  if (request.status !== "pending") return NextResponse.json({ error: "Request already resolved." }, { status: 409 });

  // Add the member and mark request accepted atomically
  const { error: memberErr } = await db
    .from("community_members")
    .upsert(
      { community_id: communityId, user_id: request.user_id, role: "member" },
      { onConflict: "community_id,user_id", ignoreDuplicates: true }
    );

  if (memberErr) return NextResponse.json({ error: "Failed to add member." }, { status: 500 });

  await db
    .from("community_join_requests")
    .update({ status: "accepted", decided_at: new Date().toISOString(), decided_by: userId })
    .eq("id", requestId);

  // Audit trail
  const [{ data: actor }, { data: targetUser }] = await Promise.all([
    db.from("users").select("name").eq("id", userId).maybeSingle(),
    db.from("users").select("name").eq("id", request.user_id).maybeSingle(),
  ]);
  await logCommunityActivity(db, {
    communityId,
    actorId: userId,
    actorRole: managerStatus.isOwner ? "owner" : "admin",
    actorName: actor?.name ?? null,
    action: "join_request_accepted",
    targetUserId: request.user_id,
    details: { member_name: targetUser?.name ?? null },
  });

  return NextResponse.json({ success: true });
}
