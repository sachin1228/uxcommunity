"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchJsonCached, invalidateRequest } from "@/lib/request-cache";
import { invalidateCommunitiesList } from "@/lib/communities/cache";
import type { CachedCommunityChannel } from "@/lib/communities/cache";

const CHANNELS_STALE_MS = 60_000;

interface UseCommunityChannelsOptions {
  communityId: string;
  currentUserId: string;
  /** When false (e.g. the manager modal is closed) no fetch is issued. */
  enabled?: boolean;
}

export function useCommunityChannels({ communityId, currentUserId, enabled = true }: UseCommunityChannelsOptions) {
  const [channels, setChannels] = useState<CachedCommunityChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const communityIdRef = useRef(communityId);

  useEffect(() => {
    communityIdRef.current = communityId;
  }, [communityId]);

  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    const targetId = communityId;
    fetchJsonCached<{ channels?: CachedCommunityChannel[] }>(
      `/api/communities/${targetId}/channels`,
      { staleMs: CHANNELS_STALE_MS },
      currentUserId,
    )
      .then((data) => {
        if (cancelled || communityIdRef.current !== targetId) return;
        setChannels(data?.channels ?? []);
      })
      .catch(() => {
        if (cancelled || communityIdRef.current !== targetId) return;
        setError("Failed to load channels.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [communityId, currentUserId, enabled]);

  const createChannel = useCallback(
    async (name: string): Promise<{ ok: boolean; error?: string }> => {
      const targetId = communityIdRef.current;
      try {
        const res = await fetch(`/api/communities/${targetId}/channels`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) return { ok: false, error: data?.error ?? "Failed to create channel." };
        setChannels((prev) => [...prev, data.channel as CachedCommunityChannel]);
        invalidateRequest(`/api/communities/${targetId}/channels`, currentUserId);
        invalidateCommunitiesList();
        setError(null);
        return { ok: true };
      } catch {
        return { ok: false, error: "Network error. Please try again." };
      }
    },
    [currentUserId],
  );

  const renameChannel = useCallback(
    async (channelId: string, name: string): Promise<{ ok: boolean; error?: string }> => {
      const targetId = communityIdRef.current;
      try {
        const res = await fetch(`/api/communities/${targetId}/channels/${channelId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) return { ok: false, error: data?.error ?? "Failed to rename channel." };
        setChannels((prev) =>
          prev.map((ch) => (ch.id === channelId ? (data.channel as CachedCommunityChannel) : ch))
        );
        invalidateRequest(`/api/communities/${targetId}/channels`, currentUserId);
        invalidateCommunitiesList();
        setError(null);
        return { ok: true };
      } catch {
        return { ok: false, error: "Network error. Please try again." };
      }
    },
    [currentUserId],
  );

  const deleteChannel = useCallback(
    async (channelId: string): Promise<{ ok: boolean; error?: string }> => {
      const targetId = communityIdRef.current;
      try {
        const res = await fetch(`/api/communities/${targetId}/channels/${channelId}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const data = await res.json().catch(() => null);
          return { ok: false, error: data?.error ?? "Failed to delete channel." };
        }
        setChannels((prev) => prev.filter((ch) => ch.id !== channelId));
        invalidateRequest(`/api/communities/${targetId}/channels`, currentUserId);
        invalidateCommunitiesList();
        setError(null);
        return { ok: true };
      } catch {
        return { ok: false, error: "Network error. Please try again." };
      }
    },
    [currentUserId],
  );

  return { channels, loading, error, createChannel, renameChannel, deleteChannel };
}