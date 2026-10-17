import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { loadCommunityManagerStatus } from "@/lib/communities/manager-role";
import { canStoreJoinRequestMessage } from "@/lib/communities/showcase-flag";
import { COMMUNITY_REQUESTS_TAG } from "@/lib/communities/read-models";

/**
 * GET /api/communities/[id]/requests
 * List pending join requests. Owner or manager with "manage members".
 *
 * The list is read on every members-tab open and by the tab-dot poll, and it
 * only changes when someone requests to join or an admin accepts/declines —
 * all of which call `revalidateTag(COMMUNITY_REQUESTS_TAG)`. Served from the
 * Next data cache (R2-backed on the deployed Worker) for five minutes so the
 * open path reads one round trip (the permission gate below) instead of two
 * waves of joins. Keyed per community only: every admitted manager sees the
 * same list, and the gate runs BEFORE the cache read.
 */
const loadPendingRequestsCached = unstable_cache(
  async (communityId: string) => {
    const db = createServiceClient();

    // The optional request note ships only once its migration is applied (see
    // the probe's own notes); another probe per cache window is its normal
    // once-per-process cost, not a per-read one.
    const { data: requests, error } = await (
      (await canStoreJoinRequestMessage(db))
        ? db
            .from("community_join_requests")
            .select("id, user_id, requested_at, request_message")
            .eq("community_id", communityId)
            .eq("status", "pending")
            .order("requested_at", { ascending: true })
        : db
            .from("community_join_requests")
            .select("id, user_id, requested_at")
            .eq("community_id", communityId)
            .eq("status", "pending")
            .order("requested_at", { ascending: true })
    );

    if (error) throw new Error("Failed to fetch requests.");
    if (!requests?.length) return [];

    const userIds = requests.map((r) => r.user_id);
    const [{ data: users }, { data: profiles }] = await Promise.all([
      db.from("users").select("id, name").in("id", userIds),
      db.from("designer_profiles").select("user_id, avatar_url").in("user_id", userIds),
    ]);

    const userMap    = Object.fromEntries((users    ?? []).map((u) => [u.id, u.name]));
    const profileMap = Object.fromEntries((profiles ?? []).map((p) => [p.user_id, p.avatar_url]));

    return requests.map((r) => ({
      id:              r.id,
      user_id:         r.user_id,
      requested_at:    r.requested_at,
      name:            userMap[r.user_id]    ?? "Unknown",
      avatar_url:      profileMap[r.user_id] ?? null,
      request_message:
        "request_message" in r ? r.request_message ?? null : null,
    }));
  },
  ["community-pending-requests"],
  { revalidate: 300, tags: [COMMUNITY_REQUESTS_TAG] },
);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let session;
  try { session = await requireSession("user"); } catch (e) { return e as Response; }
  const userId = session.userId!;
  const { id: communityId } = await params;
  const db = createServiceClient();

  // Verify caller is a manager with member-management rights
  const managerStatus = await loadCommunityManagerStatus(db, communityId, userId);
  if (!managerStatus) return NextResponse.json({ error: "Community not found." }, { status: 404 });
  if (!managerStatus.isOwner && !managerStatus.permissions.can_manage_members) {
    return NextResponse.json({ error: "You don't have permission to manage members." }, { status: 403 });
  }

  let requests;
  try {
    requests = await loadPendingRequestsCached(communityId);
  } catch {
    return NextResponse.json({ error: "Failed to fetch requests." }, { status: 500 });
  }
  return NextResponse.json({ requests });
}
