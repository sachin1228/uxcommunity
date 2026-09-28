/**
 * Bounded, TTL'd cache for the chat timeline's content-event id lookup.
 *
 * WHY THIS EXISTS (production-readiness audit, M-11)
 *   Every chat page fetch with `withContentReactions=1` (the web chat always
 *   sets it) ran FOUR extra `select id … order by created_at limit 50` queries —
 *   one each for threads, showcase posts, resources and events — purely to pass
 *   those ids into `get_community_message_page` so it can attach the cards'
 *   reaction groups. The ids only change when a member creates or deletes
 *   content, but they were re-queried on every page fetch, catch-up and
 *   pagination request.
 *
 *   A short per-community cache removes that repeated read: the first chat fetch
 *   in a 60 s window pays the four queries, the rest reuse the ids. This is the
 *   audit's suggested fix (cache per community 60 s) and deliberately does NOT
 *   change the response shape or the RPC contract.
 *
 * CONCURRENCY / BOUNDS
 *   - In-flight de-duplication: N simultaneous first requests for one community
 *     issue ONE lookup.
 *   - At most `maxEntries` communities are cached (LRU eviction); a hot
 *     multi-tenant isolate cannot grow without bound.
 *   - Staleness is bounded by `ttlMs`. A newly created card appears on the next
 *     fetch after expiry, and the timeline is refreshed by the content events
 *     themselves in the meantime.
 *
 * The loader is injected so the cache behaviour is unit-testable without a
 * database; `app/api/communities/[id]/messages/route.ts` supplies the real one.
 */

export interface ContentEventIdCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export interface ContentEventIdCache {
  /** Cached ids for a community, loading (deduplicated) on a miss. */
  load(communityId: string): Promise<string[]>;
  /** Drop one community (e.g. its content changed). */
  invalidate(communityId: string): void;
  clear(): void;
  /** Number of cached communities — exposed for tests/observability. */
  readonly size: number;
}

export function createContentEventIdCache(
  loader: (communityId: string) => Promise<string[]>,
  options: ContentEventIdCacheOptions = {},
): ContentEventIdCache {
  const ttlMs = options.ttlMs ?? 60_000;
  const maxEntries = options.maxEntries ?? 200;
  const now = options.now ?? Date.now;

  const entries = new Map<string, { ids: string[]; expiresAt: number }>();
  const inFlight = new Map<string, Promise<string[]>>();

  return {
    async load(communityId: string): Promise<string[]> {
      const cached = entries.get(communityId);
      if (cached && cached.expiresAt > now()) {
        // Refresh LRU position: the cache is capped, so the actively viewed
        // community must not be evicted by a scan of many others.
        entries.delete(communityId);
        entries.set(communityId, cached);
        return cached.ids;
      }
      if (cached) entries.delete(communityId);

      const pending = inFlight.get(communityId);
      if (pending) return pending;

      const request = loader(communityId)
        .then((ids) => {
          entries.set(communityId, { ids, expiresAt: now() + ttlMs });
          while (entries.size > maxEntries) {
            const oldest = entries.keys().next().value;
            if (oldest === undefined) break;
            entries.delete(oldest);
          }
          return ids;
        })
        .finally(() => inFlight.delete(communityId));

      inFlight.set(communityId, request);
      return request;
    },

    invalidate(communityId: string): void {
      entries.delete(communityId);
    },

    clear(): void {
      entries.clear();
      inFlight.clear();
    },

    get size(): number {
      return entries.size;
    },
  };
}
