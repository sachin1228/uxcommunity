import { useCallback } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { FeedItem, getHomeFeed } from '@/lib/feed';

const PAGE_SIZE = 30;

export function feedKey() {
  return ['home-feed'] as const;
}

export function useFeed() {
  const queryClient = useQueryClient();

  const query = useInfiniteQuery<FeedItem[], Error>({
    queryKey: feedKey(),
    queryFn: async ({ pageParam }) => {
      const res = await getHomeFeed(pageParam as string | undefined);
      return res.items;
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => {
      if (lastPage.length < PAGE_SIZE) return undefined;
      return lastPage[lastPage.length - 1].created_at;
    },
    staleTime: 30_000,
  });

  const pages = query.data?.pages ?? [];
  const items = pages.flat();
  const hasMore = query.hasNextPage ?? false;

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: feedKey() });
  }, [queryClient]);

  return {
    items,
    isLoading: query.isLoading,
    isFetchingNextPage: query.isFetchingNextPage,
    hasNextPage: hasMore,
    fetchNextPage: query.fetchNextPage,
    refetch,
    error: query.error?.message ?? null,
  };
}
