import { useRef, useCallback } from "react";
import {
  msgCache,
  msgFetchedAt,
  metaCache,
  evictIfNeeded,
  MSG_STALE_MS,
  META_STALE_MS,
  type CachedMessage,
  type CachedMeta,
} from "@/lib/communities/cache";
import { fetchJsonCached } from "@/lib/request-cache";

/**
 * Prefetch messages and metadata for a community on hover.
 * The shared request cache coordinates hover, navigation, and mounted callers.
 */
export function usePrefetch(currentUserId: string) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onEnter = useCallback((communityId: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const messagesUrl = `/api/communities/${communityId}/messages`;
      const metadataUrl = `/api/communities/${communityId}`;

      void fetchJsonCached<{ messages?: CachedMessage[] }>(
        messagesUrl,
        { staleMs: MSG_STALE_MS },
        currentUserId,
      )
        .then((data) => {
          if (!data.messages) return;
          msgCache.set(communityId, data.messages);
          msgFetchedAt.set(communityId, Date.now());
          evictIfNeeded();
        })
        .catch(() => {});

      void fetchJsonCached<Omit<CachedMeta, "fetchedAt">>(
        metadataUrl,
        { staleMs: META_STALE_MS },
        currentUserId,
      )
        .then((data) => {
          if (!data.community) return;
          metaCache.set(communityId, {
            community: data.community,
            members: data.members ?? [],
            fetchedAt: Date.now(),
          });
          evictIfNeeded();
        })
        .catch(() => {});
    }, 200);
  }, [currentUserId]);

  const onLeave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return { onEnter, onLeave };
}
