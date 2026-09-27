import { useCallback, useEffect, useMemo } from 'react';
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { realtimeClient, realtimeRooms } from '@/lib/realtime';
import { createCatchUpScheduler } from '@/lib/realtimeCatchUp';
import { ContentByKind, ContentKind, getCommunityContent } from '@/lib/communityContent';

export function communityContentKey(communityId: string, kind: ContentKind) {
  return ['community-content', communityId, kind] as const;
}

/**
 * Map content kind → Cloudflare Realtime room and the topics to subscribe.
 * Each kind subscribes to the appropriate room and listens for relevant events.
 *
 * Showcase is absent on purpose: its realtime room is keyed by *post* id on the
 * web, not by community, so there is nothing community-scoped to subscribe to.
 * The tab stays fresh through the foreground refetch below and pull-to-refresh.
 */
const ROOM_TOPICS: Partial<Record<ContentKind, { getRoom: (cid: string) => string; topics: string[] }>> = {
  threads: {
    getRoom: (cid) => realtimeRooms.threads(cid),
    topics: ['thread', 'like', 'save'],
  },
  events: {
    getRoom: (cid) => realtimeRooms.events(cid),
    topics: ['event', 'rsvp', 'like', 'save'],
  },
  resources: {
    getRoom: (cid) => realtimeRooms.resources(cid),
    topics: ['resource', 'save'],
  },
};

export function useCommunityContent<K extends ContentKind>(communityId: string, kind: K, enabled = true) {
  const queryClient = useQueryClient();
  const queryKey = communityContentKey(communityId, kind);
  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey }),
    [queryClient, queryKey]
  );

  const query = useQuery<ContentByKind[K][]>({
    queryKey,
    queryFn: () => getCommunityContent(communityId, kind),
    enabled: Boolean(communityId && enabled),
    staleTime: 20_000,
  });

  /**
   * Refetch trigger for realtime gaps.
   *
   * A tab whose socket dropped missed the inserts/updates published in the
   * meantime and there is no cursor to ask for them, so the honest recovery is
   * a refetch. Debounced and single-flight so a flaky network (a burst of
   * reconnects plus a foreground) still produces one refetch, and React Query
   * dedupes it against an already-running one.
   */
  const gapRefetch = useMemo(
    () => createCatchUpScheduler(invalidate, { debounceMs: 500 }),
    [invalidate],
  );
  useEffect(() => () => gapRefetch.cancel(), [gapRefetch]);

  // Realtime subscription via Cloudflare singleton
  useEffect(() => {
    if (!communityId || !enabled) return;

    const config = ROOM_TOPICS[kind];
    if (!config) return;
    const room = config.getRoom(communityId);
    realtimeClient.connect(room);
    // Refcounted room subscription: releasing it must not tear the socket down
    // while another screen still listens to the same room.
    const unsubRoom = realtimeClient.subscribe(room);

    const unsubscribes = config.topics.map((topic) =>
      realtimeClient.on(room, topic, invalidate)
    );
    // Whatever was published before this socket came up is gone; refetch it
    // instead of waiting for the next tab switch.
    unsubscribes.push(
      realtimeClient.onRoomStatus(room, (connected) => {
        if (connected) gapRefetch.schedule();
      }),
    );

    return () => {
      unsubscribes.forEach((unsub) => unsub());
      unsubRoom();
    };
  }, [communityId, enabled, invalidate, kind, gapRefetch]);

  useEffect(() => {
    if (!enabled) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') gapRefetch.schedule();
    });
    return () => subscription.remove();
  }, [enabled, gapRefetch]);

  return query;
}
