import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";
import { loadCommunityManagerStatus } from "@/lib/communities/manager-role";

/**
 * GET /api/communities/[id]/content-latest
 *
 * The newest created_at per content area — threads / showcase / resources /
 * events — plus, for the manager tier only, the newest management-audit row.
 * The community nav's per-tab "new since you last looked" dots compare these
 * against a per-tab watermark (see lib/communities/tab-seen.ts on the client);
 * the chat timeline's own content-event window can be up to
 * COMMUNITY_BOOTSTRAP_STALE_MS old, so the dots cannot rely on it alone.
 *
 * Member-only, like the page itself. The activity field follows the Activity
 * tab's own gate (owner / app-created community's admin).
 *
 * The probes only move when content is created, so the whole answer is served
 * from the Next data cache (R2-backed on the deployed Worker) for five minutes:
 * the dots tolerate a delayed RAISE — anything newer is already in the live
 * timeline window they also read (see useCommunityTabDots). Keyed per
 * community AND per activity-visibility so a manager's answer can never be
 * served to a member.
 */
const loadContentLatest = unstable_cache(
  async (communityId: string, includeActivity: boolean) => {
    const db = createServiceClient();

    // Best-effort per table: one missing timestamp must not blank the others —
    // the client falls back to the timeline's own window for that kind.
    const newest = (
      result: { data: Array<{ created_at: string }> | null; error: { message: string } | null },
    ): string | null => (result.error ? null : result.data?.[0]?.created_at ?? null);

    const [threadsRes, showcaseRes, resourcesRes, eventsRes] = await Promise.all([
      db.from("community_threads").select("created_at").eq("community_id", communityId).order("created_at", { ascending: false }).limit(1),
      db.from("community_showcase_posts").select("created_at").eq("community_id", communityId).order("created_at", { ascending: false }).limit(1),
      db.from("community_resources").select("created_at").eq("community_id", communityId).order("created_at", { ascending: false }).limit(1),
      db.from("community_events").select("created_at").eq("community_id", communityId).order("created_at", { ascending: false }).limit(1),
    ]);

    let activity: string | null = null;
    if (includeActivity) {
      const activityRes = await db
        .from("community_admin_activity")
        .select("created_at")
        .eq("community_id", communityId)
        .order("created_at", { ascending: false })
        .limit(1);
      activity = newest(activityRes);
    }

    return {
      thread: newest(threadsRes),
      showcase: newest(showcaseRes),
      resource: newest(resourcesRes),
      event: newest(eventsRes),
      activity,
    };
  },
  ["community-content-latest"],
  { revalidate: 300 },
);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession("user", { verifyActive: false });
  } catch (error) {
    return error as Response;
  }
  const { id: communityId } = await params;

  const db = createServiceClient();
  const status = await loadCommunityManagerStatus(db, communityId, session.userId!);
  if (!status || !status.role) {
    return NextResponse.json({ error: "Community not found." }, { status: 404 });
  }

  return NextResponse.json({
    latest: await loadContentLatest(communityId, status.canManageModerators),
  });
}
