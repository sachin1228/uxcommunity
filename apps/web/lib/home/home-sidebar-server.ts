/**
 * Server-side data for the homepage rail (trending posts + suggested
 * communities).
 *
 * Both lists are read while the dashboard page renders, so the rail arrives with
 * the rest of the page instead of flashing in from a client fetch. They are
 * deliberately *not* part of the feed request: the feed is per-user and changes
 * constantly, while these two are a slower snapshot.
 */

import "server-only";
import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import { SUGGESTED_COMMUNITIES_TAG, TRENDING_POSTS_TAG } from "./home-rail-cache";
import {
  rankTrendingPosts,
  TRENDING_MAX_CANDIDATES,
  TRENDING_POST_LIMIT,
  TRENDING_WINDOW_DAYS,
  type TrendingPost,
  type TrendingPostCandidate,
} from "./trending";
import {
  pickSuggestedCommunities,
  SUGGESTION_LIMIT,
  type SuggestedCommunity,
  type SuggestedCommunitySource,
} from "./suggested";

/** The trend window, in milliseconds. */
const WINDOW_MS = TRENDING_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/** A thread row with its engagement aggregated in the database. */
type ThreadEngagementRow = {
  id: string;
  title: string;
  community_id: string;
  created_at: string;
  /** Embedded aggregate rows come back as `[{ count }]`. */
  thread_likes: { count: number }[] | null;
  thread_comments: { count: number }[] | null;
};

function countOf(value: { count: number }[] | null | undefined): number {
  const row = Array.isArray(value) ? value[0] : value;
  const count = row?.count;
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

/**
 * The week's public posts with their engagement, cached for two minutes.
 *
 * One request: PostgREST aggregates the likes and comments per post in the
 * database, so nothing here scales with how many people liked a post. Trending
 * posts are the same list for every member, so this build is shared across the
 * whole deployment. Ranking itself is NOT cached — the age fade has to be
 * applied to the current clock (see getTrendingPosts), otherwise the order would
 * freeze for the life of the cache entry.
 *
 * Visibility matches the homepage feed exactly: a post is a candidate when it
 * is marked public (`is_public = true`, "any logged-in member can read this"),
 * so the card can never surface a post its own community would not show.
 */
const loadTrendingCandidates = unstable_cache(
  async (): Promise<TrendingPostCandidate[]> => {
    const db = createServiceClient();
    const since = new Date(Date.now() - WINDOW_MS).toISOString();

    // supabase-js has no generated types in this project, so every query result
    // infers as `never`; the cast states the shape this response actually has.
    const { data, error } = (await db
      .from("community_threads")
      .select(
        "id, title, community_id, created_at, thread_likes(count), thread_comments(count)",
      )
      .eq("is_public", true)
      .gte("created_at", since)
      // Newest first: the candidate cap then trims the oldest end of the window.
      .order("created_at", { ascending: false })
      .limit(TRENDING_MAX_CANDIDATES)) as unknown as {
      data: ThreadEngagementRow[] | null;
      error: { message: string } | null;
    };

    if (error) {
      console.error("[home trending] thread engagement query failed:", error.message);
      return [];
    }

    return (data ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      community_id: row.community_id,
      created_at: row.created_at,
      like_count: countOf(row.thread_likes),
      comment_count: countOf(row.thread_comments),
    }));
  },
  ["home-trending-posts", String(TRENDING_WINDOW_DAYS)],
  { revalidate: 120, tags: [TRENDING_POSTS_TAG] },
);

/** Names for the handful of communities the ranked posts live in. */
async function communityNamesFor(
  posts: readonly TrendingPostCandidate[],
): Promise<Map<string, string>> {
  const ids = [...new Set(posts.map((post) => post.community_id))];
  if (!ids.length) return new Map();

  const db = createServiceClient();
  const { data, error } = (await db
    .from("communities")
    .select("id, name")
    .in("id", ids)) as unknown as {
    data: { id: string; name: string }[] | null;
    error: { message: string } | null;
  };
  if (error) {
    console.error("[home trending] community names query failed:", error.message);
    return new Map();
  }

  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

/** The week's most engaging public posts, ranked with a fresh age fade. */
export async function getTrendingPosts(now = Date.now()): Promise<TrendingPost[]> {
  const ranked = rankTrendingPosts(await loadTrendingCandidates(), {
    now,
    limit: TRENDING_POST_LIMIT,
  });
  if (!ranked.length) return [];

  const names = await communityNamesFor(ranked);
  return ranked.map((post) => ({
    ...post,
    community_name: names.get(post.community_id) ?? null,
  }));
}

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
  trending: TrendingPost[];
  suggested: SuggestedCommunity[];
}

/** Everything the homepage rail renders, fetched concurrently. */
export async function getHomeRailData(userId: string): Promise<HomeRailData> {
  const [trending, suggested] = await Promise.all([
    getTrendingPosts(),
    getSuggestedCommunities(userId),
  ]);
  return { trending, suggested };
}
