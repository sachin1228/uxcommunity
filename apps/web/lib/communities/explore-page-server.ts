/**
 * One page of the Explore directory, cached.
 *
 * WHY THIS EXISTS
 *   `GET /api/communities/all` is the only read of the platform-wide directory,
 *   and before this it was uncached as well as unbounded: every Explore visit
 *   re-read the whole table. The bound is in SQL now
 *   (20261015150000_all_communities_cursor); this module is the other half — the
 *   same page, for the same member, is served from cache for a minute, so a
 *   member flipping between tabs and cards does not re-read it, while a join
 *   still takes effect immediately (the join route revalidates the tag).
 *
 * WHY IT IS PER MEMBER, ALWAYS
 *   A page carries the caller's own `joined` and `has_pending_request` flags —
 *   the directory is not the same answer for two people, so the member's id is
 *   part of every cache key. There is no shared, viewer-independent entry here
 *   on purpose: rls is bypassed on the server (service-role), so a shared cache
 *   would be a leak rather than an optimization.
 */

import "server-only";
import { unstable_cache } from "next/cache";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import type { CachedExploreCommunity } from "./cache/types";
import {
  EXPLORE_COMMUNITIES_TAG,
  EXPLORE_PAGE_REVALIDATE_SECONDS,
} from "./explore-cache";
import type { ExploreCursor } from "./explore-cursor";

/**
 * The RPC read, cached per (member, page position).
 *
 * The cursor halves are separate arguments rather than one opaque string, so the
 * cache key is the two values the SQL predicate actually compares.
 */
const loadExplorePage = unstable_cache(
  async (
    userId: string,
    limit: number,
    afterName: string | null,
    afterId: string | null,
  ): Promise<CachedExploreCommunity[]> => {
    const db = createServiceClient();
    const { data, error } = await callPerformanceRpc(db, "get_all_communities", {
      p_user_id: userId,
      p_limit: limit,
      p_after_name: afterName,
      p_after_id: afterId,
    });

    // Unlike the rail, an empty list here is not a decoration that can quietly
    // disappear: Explore showing "no communities found" would be a lie about the
    // directory. So a failed read throws and the route answers 500 — and nothing
    // is cached for it.
    if (error) {
      throw new Error(`get_all_communities failed: ${error.message}`);
    }

    return (data ?? []) as CachedExploreCommunity[];
  },
  ["explore-communities-page"],
  { revalidate: EXPLORE_PAGE_REVALIDATE_SECONDS, tags: [EXPLORE_COMMUNITIES_TAG] },
);

export interface ExplorePage {
  rows: CachedExploreCommunity[];
  /**
   * Whether the directory continues past this page — asked for by requesting one
   * row more than the page holds (the same over-read the jobs feed uses), so
   * "is there more" costs a row, not a second count over the directory.
   */
  hasMore: boolean;
}

/** One page of the directory: `after` is the previous page's last row, or null. */
export async function getExplorePage(
  userId: string,
  pageSize: number,
  after: ExploreCursor | null,
): Promise<ExplorePage> {
  const rows = await loadExplorePage(
    userId,
    pageSize + 1,
    after?.name ?? null,
    after?.id ?? null,
  );

  const hasMore = rows.length > pageSize;
  return { rows: hasMore ? rows.slice(0, pageSize) : rows, hasMore };
}
