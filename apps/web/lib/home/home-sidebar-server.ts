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
import { SUGGESTED_COMMUNITIES_TAG } from "./home-rail-cache";
import {
  pickSuggestedCommunities,
  toSuggestedSources,
  SUGGESTION_LIMIT,
  type CommunityCatalogRow,
  type SuggestedCommunity,
} from "./suggested";

/**
 * The member-independent catalog behind the rail.
 *
 * Cached once per revalidation window instead of once per member: the previous
 * per-member cache re-read every community on every dashboard and public-detail
 * render, which made this rail the app's largest source of database egress.
 * Only the member's memberships change per call, and they are read separately
 * below.
 */
const loadSuggestableCatalog = unstable_cache(
  async (): Promise<CommunityCatalogRow[]> => {
    const db = createServiceClient();
    const { data, error } = await db
      .from("communities")
      .select("id, name, type, image_url, description, is_private, member_count")
      .eq("is_active", true)
      .eq("type", "user")
      .gt("member_count", 0)
      .order("name");

    if (error) {
      console.error("[home suggestions] catalog read failed:", error.message);
      return [];
    }

    return (data ?? []) as unknown as CommunityCatalogRow[];
  },
  ["home-suggestable-catalog"],
  { revalidate: 60, tags: [SUGGESTED_COMMUNITIES_TAG] },
);

/** One small per-member read; the shared catalog carries everything else. */
async function loadJoinedCommunityIds(userId: string): Promise<Set<string>> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("community_members")
    .select("community_id")
    .eq("user_id", userId);

  if (error) {
    console.error("[home suggestions] membership read failed:", error.message);
    return new Set();
  }

  return new Set(
    ((data ?? []) as unknown as Array<{ community_id: string }>).map(
      (row) => row.community_id,
    ),
  );
}

/** Suggested communities for one member, biggest first. */
export async function getSuggestedCommunities(
  userId: string,
  limit: number = SUGGESTION_LIMIT,
): Promise<SuggestedCommunity[]> {
  if (!userId) return [];
  const [catalog, joined] = await Promise.all([
    loadSuggestableCatalog(),
    loadJoinedCommunityIds(userId),
  ]);
  return pickSuggestedCommunities(toSuggestedSources(catalog, joined), limit);
}

export interface HomeRailData {
  suggested: SuggestedCommunity[];
}

/** Everything the homepage rail renders. */
export async function getHomeRailData(userId: string): Promise<HomeRailData> {
  return { suggested: await getSuggestedCommunities(userId) };
}
