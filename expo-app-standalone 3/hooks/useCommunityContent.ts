import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { ContentByKind, ContentKind, getCommunityContent } from '@/lib/communityContent';

const TABLES: Record<ContentKind, string[]> = {
  threads: ['community_threads', 'thread_likes', 'thread_saves', 'thread_comments'],
  events: ['community_events', 'event_rsvps', 'event_saves'],
  resources: ['community_resources', 'resource_saves', 'resource_bookmarks', 'resource_comments'],
};

export function communityContentKey(communityId: string, kind: ContentKind) {
  return ['community-content', communityId, kind] as const;
}

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

  useEffect(() => {
    if (!communityId || !enabled) return;
    const channel = supabase.channel(`mobile-${kind}-${communityId}`);
    TABLES[kind].forEach((table) => {
      channel.on(
        'postgres_changes',
        table.startsWith('community_')
          ? { event: '*', schema: 'public', table, filter: `community_id=eq.${communityId}` }
          : { event: '*', schema: 'public', table },
        invalidate
      );
    });
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
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
