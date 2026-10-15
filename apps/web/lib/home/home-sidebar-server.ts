/**
 * Server-side data for the homepage rail (suggested communities).
 *
 * It is read while the dashboard page renders, so the rail arrives with the
 * rest of the page instead of flashing in from a client fetch. It is
 * deliberately *not* part of the feed request: the feed is per-user and changes
 * constantly, while this is a slower snapshot.
 */

import "server-only";
import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import { SUGGESTED_COMMUNITIES_TAG } from "./home-rail-cache";
import {
  pickSuggestedCommunities,
  SUGGESTION_LIMIT,
  type SuggestedCommunity,
  type SuggestedCommunitySource,
} from "./suggested";

/**
 * The eligible-community projection, cached per member for a minute.
 *
 * `get_suggested_communities` is the rail's OWN read, added when the Explore
 * directory gained a bound (20261015150000_all_communities_cursor): the rail
 * wants the biggest communities the member could join, which is a top-N by
 * member count, and that is not expressible as a page of a name-ordered list.
 * It is bounded in SQL (SUGGESTION_LIMIT rows, not the platform's whole
 * directory) and cached per member, because the rail is re-read on a route the
 * member visits several times in a session (it also sits beside the public
 * thread/showcase/resource/event detail pages). Joining calls
 * revalidateTag(SUGGESTED_COMMUNITIES_TAG) so the member never gets offered a
 * community they just joined.
 */
const loadEligibleCommunities = unstable_cache(
  async (userId: string): Promise<SuggestedCommunitySource[]> => {
    const db = createServiceClient();
    const { data, error } = await callPerformanceRpc(db, "get_suggested_communities", {
      p_user_id: userId,
      p_limit: SUGGESTION_LIMIT,
    });

    if (error) {
      console.error("[home suggestions] get_suggested_communities failed:", error.message);
      return [];
    }

    return (data ?? []) as unknown as SuggestedCommunitySource[];
  },
  ["home-suggested-communities"],
  { revalidate: 60, tags: [SUGGESTED_COMMUNITIES_TAG] },
);

/** Suggested communities for one member, biggest first. */
export async function getSuggestedCommunities(
  userId: string,
  limit: number = SUGGESTION_LIMIT,
): Promise<SuggestedCommunity[]> {
  if (!userId) return [];
  return pickSuggestedCommunities(await loadEligibleCommunities(userId), limit);
}

export interface HomeRailData {
  suggested: SuggestedCommunity[];
}

/** Everything the homepage rail renders. */
export async function getHomeRailData(userId: string): Promise<HomeRailData> {
  return { suggested: await getSuggestedCommunities(userId) };
}
