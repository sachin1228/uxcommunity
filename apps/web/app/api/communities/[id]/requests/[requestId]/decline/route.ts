import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { loadCommunityManagerStatus, logCommunityActivity, managerActorRole } from "@/lib/communities/manager-role";

/**
 * POST /api/communities/[id]/requests/[requestId]/decline
 * Decline a pending join request. Owner or manager with "manage members".
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
  if (!managerStatus.isOwner && !managerStatus.permissions.can_manage_members) {
    return NextResponse.json({ error: "You don't have permission to manage members." }, { status: 403 });
  }

  const { data: request } = await db
    .from("community_join_requests")
    .select("id, user_id, status")
    .eq("id", requestId)
    .eq("community_id", communityId)
    .maybeSingle();

  if (!request) return NextResponse.json({ error: "Request not found." }, { status: 404 });
  if (request.status !== "pending") return NextResponse.json({ error: "Request already resolved." }, { status: 409 });

  await db
    .from("community_join_requests")
    .update({ status: "declined", decided_at: new Date().toISOString(), decided_by: userId })
    .eq("id", requestId);

  // Audit trail
  const { data: targetUser } = await db.from("users").select("name").eq("id", request.user_id).maybeSingle();
  await logCommunityActivity(db, {
    communityId,
    actorId: userId,
    actorRole: managerActorRole(managerStatus),
    action: "join_request_declined",
    targetUserId: request.user_id,
    details: { member_name: targetUser?.name ?? null },
  });

  return NextResponse.json({ success: true });
}
