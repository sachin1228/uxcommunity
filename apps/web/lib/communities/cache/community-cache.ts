/**
 * The per-community client caches: the loaded message page, the community meta
 * payload, the read marker the page loaded with, and the in-flight fetches that
 * share them.
 *
 * WHY THIS EXISTS
 *   These four maps are one cache with one lifecycle: they are keyed by
 *   community id, bounded together (writing one evicts for the others), and
 *   dropped together when the user leaves or the community is deleted. They used
 *   to sit in the same 771-line module as the sidebar/explore stores and three
 *   policy registries, so "what happens to the chat cache when a community is
 *   archived?" had to be answered by reading unrelated code.
 *
 *   The sidebar and explore list caches deliberately do NOT live here — they are
 *   a different projection with a different staleness, built from a different
 *   endpoint, and their mutators are in ./sidebar-store.ts.
 *
 * EVICTION
 *   `BoundedCommunityMap` evicts on write, and the eviction is a full
 *   `evictCommunityState` so a dropped community cannot leave a stale entry
 *   behind in one of the sibling maps (or a reaction tombstone keyed by it).
 *
 * DEPENDENCY DIRECTION
 *   This module is the bottom of the cache stack: it imports its shapes from
 *   ./types.ts and the tombstone cleanup from ./reactions.ts, and nothing else in
 *   the cache imports it except the sidebar store, which calls
 *   `evictCommunityState` when a community leaves the user's list.
 */

import type { CachedMessage, CachedMeta } from "./types";
import { clearReactionTombstonesForCommunity } from "./reactions";

export const META_STALE_MS      = 5 * 60_000;
export const MSG_STALE_MS       = 3 * 60_000;
export const MAX_CACHE_ENTRIES  = 25;

class BoundedCommunityMap<T> extends Map<string, T> {
  override set(key: string, value: T): this {
    // Refresh insertion order so the first key remains the least recently written.
    super.delete(key);
    super.set(key, value);
    while (this.size > MAX_CACHE_ENTRIES) {
      const oldest = this.keys().next().value;
      if (!oldest) break;
      evictCommunityState(oldest);
    }
    return this;
  }
}

export const lastReadAtOnOpen = new Map<string, string | null>();
export const msgCache         = new BoundedCommunityMap<CachedMessage[]>();
export const metaCache        = new BoundedCommunityMap<CachedMeta>();
export const msgFetchedAt     = new Map<string, number>();
export const inFlightMsgFetch = new Map<string, Promise<void>>();
export const inFlightMetaFetch = new Map<string, Promise<void>>();

export function evictCommunityState(communityId: string): void {
  msgCache.delete(communityId);
  metaCache.delete(communityId);
  msgFetchedAt.delete(communityId);
  lastReadAtOnOpen.delete(communityId);
  inFlightMsgFetch.delete(communityId);
  inFlightMetaFetch.delete(communityId);
  clearReactionTombstonesForCommunity(communityId);
}

export function evictIfNeeded(): void {
  // BoundedCommunityMap evicts synchronously on every write. Keep this export
  // for callers compiled against the previous cache API.
}
