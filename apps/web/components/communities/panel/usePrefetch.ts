import { useCallback, useEffect, useRef } from "react";

const PREFETCH_DELAY_MS = 400;

/** Prefetch only the route payload after an intentional community-row hover. */
export function usePrefetch(prefetchCommunity: (communityId: string) => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingCommunityId = useRef<string | null>(null);

  const cancelPendingPrefetch = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    pendingCommunityId.current = null;
  }, []);

  const onEnter = useCallback(
    (communityId: string) => {
      cancelPendingPrefetch();
      pendingCommunityId.current = communityId;
      timer.current = setTimeout(() => {
        if (pendingCommunityId.current !== communityId) return;
        timer.current = null;
        pendingCommunityId.current = null;
        prefetchCommunity(communityId);
      }, PREFETCH_DELAY_MS);
    },
    [cancelPendingPrefetch, prefetchCommunity],
  );

  const onLeave = useCallback(() => {
    cancelPendingPrefetch();
  }, [cancelPendingPrefetch]);

  useEffect(() => cancelPendingPrefetch, [cancelPendingPrefetch]);

  return { onEnter, onLeave };
}
