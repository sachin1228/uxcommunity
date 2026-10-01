import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { loadCommunityManagerStatus } from "@/lib/communities/manager-role";

/**
 * GET /api/communities/[id]/activity?limit=30
 *
 * The community's management audit trail (most recent first) for the owner's
 * in-chat Activity tab: which admin/moderator did what. Activity rows snapshot
 * actor/target names at write time, so no joins are needed to render the feed.
 * Owner-only: this is the owner's oversight view of their managers.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession("user", { verifyActive: false }); } catch (e) { return e as Response; }
  const callerId = session.userId!;
  const { id: communityId } = await params;

  const db = createServiceClient();

  const managerStatus = await loadCommunityManagerStatus(db, communityId, callerId);
  if (!managerStatus) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }
  if (!managerStatus.isOwner) {
    return NextResponse.json({ error: "Only the community owner can view activity." }, { status: 403 });
  }

  const rawLimit = parseInt(new URL(req.url).searchParams.get("limit") ?? "30", 10);
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 30, 1), 100);

  const { data, error } = await db
    .from("community_admin_activity")
    .select("id, community_id, actor_id, actor_role, actor_name, action, target_user_id, details, created_at")
    .eq("community_id", communityId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[community activity]", error);
    return NextResponse.json({ error: "Failed to load activity." }, { status: 500 });
  }

  return NextResponse.json({ activity: data ?? [] });
}
