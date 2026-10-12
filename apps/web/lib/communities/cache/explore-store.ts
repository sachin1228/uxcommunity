/**
 * The Explore communities list cache.
 *
 * WHY THIS EXISTS
 *   Explore is its own list projection with its own staleness (5 minutes, versus
 *   the sidebar's 1) and its own listeners, built from a different endpoint. It
 *   was one of several unrelated caches sharing a single 771-line module, so its
 *   lifetime had to be inferred from code about chats and reactions.
 *
 * WHERE THE STATE AND ITS WRITERS LIVE
 *   The state is here, and so is the one way to change it: `setExploreCommunities`
 *   (a fetched list) and `notifyExploreStoreChanged` (a surgical patch, called by
 *   the join/leave invalidations in ./sidebar-store.ts because those change both
 *   list projections at once). Both announce on EXPLORE_STORE_CHANGED_EVENT, so a
 *   component subscribes instead of copying rows into its own state — a copy is
 *   what let the Explore list keep offering "Request to join" for a community the
 *   member had already asked to join from the home feed.
 */

import type { CachedExploreCommunity } from "./types";

export const exploreStore: {
  data: { communities: CachedExploreCommunity[]; fetchedAt: number } | null;
  inflight: Promise<void> | null;
} = { data: null, inflight: null };

export const EXPLORE_STALE_MS = 5 * 60_000;

/** Fired whenever the cached rows change, so listeners re-read them. */
export const EXPLORE_STORE_CHANGED_EVENT = "uxcommunity:explore-store-changed";

/** Replaces the cached rows (a fetch landed) and tells the listeners. */
export function setExploreCommunities(
  communities: CachedExploreCommunity[],
  options: { fetchedAt?: number } = {},
): void {
  exploreStore.data = { communities, fetchedAt: options.fetchedAt ?? Date.now() };
  notifyExploreStoreChanged();
}

export function notifyExploreStoreChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EXPLORE_STORE_CHANGED_EVENT));
  }
}
