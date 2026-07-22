import { useRef, useCallback } from "react";
import {
  msgCache,
  msgFetchedAt,
  inFlightMsgFetch,
  metaCache,
  META_STALE_MS,
  inFlightMetaFetch,
  evictIfNeeded,
  MSG_STALE_MS,
  type CachedMeta,
} from "@/lib/communities/cache";

/**
 * Prefetch both messages AND metadata for a community on hover.
 *
 * - 200 ms debounce prevents spurious requests when the cursor moves quickly.
 * - Each fetch skips independently if its data is already fresh.
 * - Deduplicates in-flight requests so hover + click don't double-fetch.
 */
export function usePrefetch() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onEnter = useCallback((communityId: string) => {
    const msgFetchedAt_ = msgFetchedAt.get(communityId);
    const msgFresh = msgFetchedAt_ && Date.now() - msgFetchedAt_ < MSG_STALE_MS;
    const metaCached = metaCache.get(communityId);
    const metaFresh = metaCached && Date.now() - metaCached.fetchedAt < META_STALE_MS;

    // Both caches are warm — nothing to do.
    if (msgFresh && metaFresh) return;
    // Both fetches already in-flight — let them finish.
    if (
      (msgFresh || inFlightMsgFetch.has(communityId)) &&
      (metaFresh || inFlightMetaFetch.has(communityId))
    ) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      // ── Messages ──────────────────────────────────────────────────────────
      if (!inFlightMsgFetch.has(communityId)) {
        const fa = msgFetchedAt.get(communityId);
        if (!fa || Date.now() - fa >= MSG_STALE_MS) {
          const p: Promise<void> = fetch(`/api/communities/${communityId}/messages`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (d?.messages) {
                msgCache.set(communityId, d.messages);
                msgFetchedAt.set(communityId, Date.now());
                evictIfNeeded();
              }
            })
            .catch(() => {})
            .finally(() => inFlightMsgFetch.delete(communityId));
          inFlightMsgFetch.set(communityId, p);
        }
      }

      // ── Metadata + members ────────────────────────────────────────────────
      if (!inFlightMetaFetch.has(communityId)) {
        const mc = metaCache.get(communityId);
        if (!mc || Date.now() - mc.fetchedAt >= META_STALE_MS) {
          const p: Promise<void> = fetch(`/api/communities/${communityId}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              if (d?.community) {
                const cached: CachedMeta = {
                  community: d.community,
                  members: d.members ?? [],
                  fetchedAt: Date.now(),
                };
                metaCache.set(communityId, cached);
              }
            })
            .catch(() => {})
            .finally(() => inFlightMetaFetch.delete(communityId));
          inFlightMetaFetch.set(communityId, p);
        }
      }
    }, 200);
  }, []);

  const onLeave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { onEnter, onLeave };
}
