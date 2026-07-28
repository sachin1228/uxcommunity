import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

/**
 * POST /api/communities/[id]/requests/[requestId]/accept
 * Accept a pending join request. Owner only.
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

  const { data: community } = await db
    .from("communities")
    .select("owner_id")
    .eq("id", communityId)
    .eq("is_active", true)
    .maybeSingle();

  if (!community) return NextResponse.json({ error: "Community not found." }, { status: 404 });
  if (community.owner_id !== userId) return NextResponse.json({ error: "Owner only." }, { status: 403 });

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

  return NextResponse.json({ success: true });
}
