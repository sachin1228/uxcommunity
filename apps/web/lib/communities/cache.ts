/**
 * Module-level caches for community data.
 * These persist across client-side navigations (SPA) without needing
 * React context, Redux, or external libraries.
 */

export interface CachedMessage {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  users: { name: string; avatar_url: string | null } | null;
  status?: "sending" | "sent" | "failed";
}

export interface CachedMeta {
  community: {
    id: string;
    name: string;
    type: string;
    member_count: number;
    image_url: string | null;
  };
  members: {
    user_id: string;
    users: { name: string; avatar_url: string | null } | null;
  }[];
  fetchedAt: number;
}

/** Messages keyed by communityId */
export const msgCache = new Map<string, CachedMessage[]>();

/** Community metadata (header + members panel) keyed by communityId */
export const metaCache = new Map<string, CachedMeta>();

/** Timestamp of the last successful full message fetch, keyed by communityId */
export const msgFetchedAt = new Map<string, number>();

/**
 * In-flight full-fetch promises keyed by communityId.
 * Hover prefetch and click both reuse the same promise — no duplicate requests.
 */
export const inFlightMsgFetch = new Map<string, Promise<void>>();

/** How long before community metadata is considered stale (ms) */
export const META_STALE_MS = 60_000; // 1 minute

/** How long before cached messages are considered stale (ms) */
export const MSG_STALE_MS = 30_000; // 30 seconds

/** Maximum number of communities to keep in each cache (FIFO eviction) */
export const MAX_CACHE_ENTRIES = 25;

/**
 * Evict the oldest entries from both caches when they exceed MAX_CACHE_ENTRIES.
 * Maps maintain insertion order, so the first key is the oldest.
 */
export function evictIfNeeded(): void {
  while (msgCache.size > MAX_CACHE_ENTRIES) {
    const oldest = msgCache.keys().next().value;
    if (!oldest) break;
    msgCache.delete(oldest);
    msgFetchedAt.delete(oldest);
  }
  while (metaCache.size > MAX_CACHE_ENTRIES) {
    const oldest = metaCache.keys().next().value;
    if (!oldest) break;
    metaCache.delete(oldest);
  }
}
