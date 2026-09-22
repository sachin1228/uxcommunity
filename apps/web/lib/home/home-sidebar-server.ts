/**
 * Server-side data for the homepage rail (trending topics + suggested
 * communities).
 *
 * Both lists are read while the dashboard page renders, so the rail arrives with
 * the rest of the page instead of flashing in from a client fetch. They are
 * deliberately *not* part of the feed request: the feed is per-user and changes
 * constantly, while these two are a slow-moving snapshot.
 */

import "server-only";
import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import {
  SUGGESTED_COMMUNITIES_TAG,
  TRENDING_TOPICS_TAG,
} from "./home-rail-cache";
import {
  aggregateTrendingTopics,
  TRENDING_MAX_THREADS,
  TRENDING_WINDOW_DAYS,
  TRENDING_LIMIT,
  type TrendingTopic,
} from "./trending";
import {
  pickSuggestedCommunities,
  SUGGESTION_LIMIT,
  type SuggestedCommunity,
  type SuggestedCommunitySource,
} from "./suggested";

/** The trend window, in milliseconds. */
const WINDOW_MS = TRENDING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Trending topics are identical for every member, so the result is cached once
 * for the whole deployment (5 minutes) rather than rebuilt per homepage view.
 *
 * Visibility matches the homepage feed exactly: a thread counts when its author
 * (or their community) marked it public (`is_public = true`). Tags are only
 * ever read, never joined — the card shows a label and a count, so a topic can
 * not leak a thread that its own community would not show.
 */
export const getTrendingTopics = unstable_cache(
  async (): Promise<TrendingTopic[]> => {
    const db = createServiceClient();
    const since = new Date(Date.now() - WINDOW_MS).toISOString();

    const { data, error } = await db
      .from("community_threads")
      .select("tags")
      .eq("is_public", true)
      .gte("created_at", since)
      // Newest first: the row cap then trims the oldest end of the window.
      .order("created_at", { ascending: false })
      .limit(TRENDING_MAX_THREADS);

    if (error) {
      console.error("[home trending] thread tags query failed:", error.message);
      return [];
    }

    return aggregateTrendingTopics(data ?? [], TRENDING_LIMIT);
  },
  ["home-trending-topics", String(TRENDING_WINDOW_DAYS)],
  { revalidate: 300, tags: [TRENDING_TOPICS_TAG] },
);

/**
 * The eligible-community projection, cached per member for a minute.
 *
 * `get_all_communities` aggregates every community's membership, so it is worth
 * not repeating on a route the member will visit several times in a session
 * (the rail also sits beside the public thread/showcase/resource/event detail
 * pages). Joining calls revalidateTag(SUGGESTED_COMMUNITIES_TAG) so the member
 * never gets offered a community they just joined.
 */
const loadEligibleCommunities = unstable_cache(
  async (userId: string): Promise<SuggestedCommunitySource[]> => {
    const db = createServiceClient();
    const { data, error } = await callPerformanceRpc(db, "get_all_communities", {
      p_user_id: userId,
    });

    if (error) {
      console.error("[home suggestions] get_all_communities failed:", error.message);
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
  trending: TrendingTopic[];
  suggested: SuggestedCommunity[];
}

/** Everything the homepage rail renders, fetched concurrently. */
export async function getHomeRailData(userId: string): Promise<HomeRailData> {
  const [trending, suggested] = await Promise.all([
    getTrendingTopics(),
    getSuggestedCommunities(userId),
  ]);
  return { trending, suggested };
}
