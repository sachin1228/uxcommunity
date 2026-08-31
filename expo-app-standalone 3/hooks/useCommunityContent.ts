import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { realtimeClient, realtimeRooms } from '@/lib/realtime';
import { ContentByKind, ContentKind, getCommunityContent } from '@/lib/communityContent';

export function communityContentKey(communityId: string, kind: ContentKind) {
  return ['community-content', communityId, kind] as const;
}

/**
 * Map content kind → Cloudflare Realtime room and the topics to subscribe.
 * Each kind subscribes to the appropriate room and listens for relevant events.
 */
const ROOM_TOPICS: Record<ContentKind, { getRoom: (cid: string) => string; topics: string[] }> = {
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

  // Realtime subscription via Cloudflare singleton
  useEffect(() => {
    if (!communityId || !enabled) return;

    const config = ROOM_TOPICS[kind];
    const room = config.getRoom(communityId);

    const unsubscribes: Array<() => void> = [];
    unsubscribes.push(realtimeClient.subscribe(room));

    config.topics.forEach((topic) => {
      unsubscribes.push(realtimeClient.on(room, topic, invalidate));
    });

    return () => {
      unsubscribes.forEach((unsub) => unsub());
    };
  }, [communityId, enabled, invalidate, kind]);

  useEffect(() => {
    if (!enabled) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') invalidate();
    });
    return () => subscription.remove();
  }, [enabled, invalidate]);

  return query;
}
