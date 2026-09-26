import type { CachedMessage, CachedMeta } from "./types";
import { clearCommunityReactionTombstones } from "./reaction-tombstones";

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
  clearCommunityReactionTombstones(communityId);
}

export function evictIfNeeded(): void {
  // BoundedCommunityMap evicts synchronously on every write. Keep this export
  // for callers compiled against the previous cache API.
}
