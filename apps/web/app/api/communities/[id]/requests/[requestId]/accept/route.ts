import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { loadCommunityManagerStatus, logCommunityActivity, managerActorRole } from "@/lib/communities/manager-role";
import { communityHref, deferNotification, joinRequestAcceptedNotice } from "@/lib/notifications";

/**
 * POST /api/communities/[id]/requests/[requestId]/accept
 * Accept a pending join request. Owner or manager with "manage members".
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
  const [{ data: targetUser }, { data: community }] = await Promise.all([
    db.from("users").select("name").eq("id", request.user_id).maybeSingle(),
    db.from("communities").select("name").eq("id", communityId).maybeSingle(),
  ]);
  await logCommunityActivity(db, {
    communityId,
    actorId: userId,
    actorRole: managerActorRole(managerStatus),
    action: "join_request_accepted",
    targetUserId: request.user_id,
    details: { member_name: targetUser?.name ?? null },
  });

  // Tell the requester they're in. Deferred (after the response) and
  // best-effort: the acceptance itself stands whether or not the notice lands,
  // and its failure only logs. It renders under the notifications page's Other
  // tab and links straight into the community chat.
  const acceptedNotice = joinRequestAcceptedNotice(
    (community as { name?: string } | null)?.name ?? "the community",
  );
  deferNotification({
    userId: request.user_id,
    actorId: userId,
    communityId,
    type: "join_request_accepted",
    entityType: "community",
    entityId: communityId,
    title: () => acceptedNotice.title,
    body: acceptedNotice.body,
    href: communityHref(communityId),
  });

  return NextResponse.json({ success: true });
}
