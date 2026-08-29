import { useCallback, useEffect, useState } from 'react';
import { getExploreCommunities, joinCommunity, type ExploreCommunity } from '@/lib/explore';

export function useExploreCommunities() {
  const [communities, setCommunities] = useState<ExploreCommunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  const fetchCommunities = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await getExploreCommunities();
      setCommunities(data);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load communities');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCommunities();
  }, [fetchCommunities]);

  const handleJoin = useCallback(async (communityId: string) => {
    setJoiningId(communityId);
    // Optimistic update
    setCommunities(prev =>
      prev.map(c =>
        c.id === communityId ? { ...c, joined: true, member_count: c.member_count + 1 } : c
      )
    );
    try {
      await joinCommunity(communityId);
    } catch {
      // Rollback on failure
      setCommunities(prev =>
        prev.map(c =>
          c.id === communityId ? { ...c, joined: false, member_count: c.member_count - 1 } : c
        )
      );
    } finally {
      setJoiningId(null);
    }
  }, []);

  return { communities, loading, error, joiningId, handleJoin, refetch: fetchCommunities };
}
