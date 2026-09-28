/**
 * The Explore communities list cache.
 *
 * WHY THIS EXISTS
 *   Explore is its own list projection with its own staleness (5 minutes, versus
 *   the sidebar's 1) and its own listeners, built from a different endpoint. It
 *   was one of several unrelated caches sharing a single 771-line module, so its
 *   lifetime had to be inferred from code about chats and reactions.
 *
 *   Only the state lives here. The mutators that *change* it are the join/leave
 *   invalidations, which belong to the sidebar projection because a join or a
 *   leave changes both lists at once — see ./sidebar-store.ts.
 */

import type { CachedExploreCommunity } from "./types";

export const exploreStore: {
  data: { communities: CachedExploreCommunity[]; fetchedAt: number } | null;
  inflight: Promise<void> | null;
} = { data: null, inflight: null };

export const EXPLORE_STALE_MS = 5 * 60_000;
