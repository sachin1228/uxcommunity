"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import {
  msgCache,
  metaCache,
  msgFetchedAt,
  evictIfNeeded,
  META_STALE_MS,
  type CachedMessage,
  type CachedMeta,
} from "@/lib/communities/cache";
import {
  fetchAndHydrateCommunityBootstrap,
  fetchJsonCached,
  getCachedRequest,
  setCachedRequest,
} from "@/lib/request-cache";

/** Must match PAGE_SIZE in the messages API route. */
const PAGE_SIZE = 50;

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export interface Community {
  id: string;
  name: string;
  type: string;
  member_count: number;
  image_url: string | null;
  description?: string | null;
  reference_name?: string | null;
  created_at?: string;
  is_private?: boolean;
  enabled_tabs?: string[];
  owner_id?: string | null;
}

export interface Member {
  user_id: string;
  users: { name: string; avatar_url: string | null; designation?: string | null; company?: string | null } | null;
}

type Message = CachedMessage;

interface UseChatDataOptions {
  communityId: string;
  currentUserId: string;
  initialMeta?: CachedMeta;
  initialMessages?: CachedMessage[];
  /** Called once on mount if SSR provided a lastReadAt and no cached messages exist. */
  onSeedLastReadAt?: (val: string | null) => void;
  /** Called once hasMounted should be set to true (first layout effect). */
  onMounted?: () => void;
}

export function useChatData({
  communityId,
  currentUserId,
  initialMeta,
  initialMessages,
  onSeedLastReadAt,
  onMounted,
}: UseChatDataOptions) {
  const [community,           setCommunity]          = useState<Community | null>(null);
  const [members,             setMembers]            = useState<Member[]>([]);
  const [messages,            setMessages]           = useState<Message[]>([]);
  const [loading,             setLoading]            = useState(true);
  const [initialMessagesReady, setInitialMessagesReady] = useState(false);
  const [hasMoreAbove,        setHasMoreAbove]       = useState(true);
  const [loadingOlder,        setLoadingOlder]       = useState(false);

  const communityIdRef         = useRef(communityId);
  const membersRef             = useRef(members);
  const pendingProfileFetchRef = useRef<Map<string, Promise<void>>>(new Map());
  const isFetchingOlderRef     = useRef(false);

  useEffect(() => {
    membersRef.current = members;
  }, [members]);

  // ── Seed state from cache or SSR props before first paint ────────────────
  useIsomorphicLayoutEffect(() => {
    onMounted?.();
    const cachedMeta = metaCache.get(communityId);
    const cachedMsgs = msgCache.get(communityId);
    if (cachedMeta) {
      setCommunity(cachedMeta.community);
      setMembers(cachedMeta.members);
    } else if (initialMeta) {
      metaCache.set(communityId, { ...initialMeta, fetchedAt: Date.now() });
      setCachedRequest(
        `/api/communities/${communityId}`,
        { community: initialMeta.community, members: initialMeta.members },
        currentUserId,
      );
      setCommunity(initialMeta.community);
      setMembers(initialMeta.members);
    }
    if (cachedMsgs?.length) {
      setMessages(cachedMsgs);
    } else if (initialMessages?.length) {
      msgCache.set(communityId, initialMessages);
      setCachedRequest(
        `/api/communities/${communityId}/messages`,
        { messages: initialMessages },
        currentUserId,
      );
      msgFetchedAt.set(communityId, Date.now());
      evictIfNeeded();
      setMessages(initialMessages);
    }
    if (cachedMeta || initialMeta) setLoading(false);
    // Notify parent of the SSR lastReadAt seed when no cache exists
    if (!cachedMsgs?.length) {
      onSeedLastReadAt?.(initialMessages?.length ? null : undefined as unknown as null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Fetch community metadata ──────────────────────────────────────────────
  const fetchMeta = useCallback(async () => {
    const targetId = communityId;
    await fetchAndHydrateCommunityBootstrap(targetId, currentUserId).catch(() => undefined);
    const d = await fetchJsonCached<{
      community: Community;
      members?: Member[];
    }>(`/api/communities/${targetId}`, { staleMs: META_STALE_MS }, currentUserId);
    if (communityIdRef.current !== targetId) return;
    const cached: CachedMeta = {
      community: d.community,
      members: d.members ?? [],
      fetchedAt: Date.now(),
    };
    metaCache.set(targetId, cached);
    setCommunity(d.community);
    setMembers(d.members ?? []);
  }, [communityId, currentUserId]);

  // ── Fetch messages (full or incremental via ?after=ISO) ───────────────────
  const fetchMessages = useCallback(
    async (after?: string): Promise<void> => {
      const targetId = communityId;
      if (!after) {
        await fetchAndHydrateCommunityBootstrap(targetId, currentUserId).catch(() => undefined);
      }
      const url = after
        ? `/api/communities/${targetId}/messages?after=${encodeURIComponent(after)}`
        : `/api/communities/${targetId}/messages`;

      return fetchJsonCached<{ messages?: Message[] }>(
        url,
        { staleMs: after ? 30_000 : 3 * 60_000 },
        currentUserId,
      )
        .then((d) => {
          if (!d) return;
          const incoming: Message[] = d.messages ?? [];
          if (after) {
            const existing   = msgCache.get(targetId) ?? [];
            const existingIds = new Set(existing.map((m) => m.id));
            const toAdd = incoming.filter((m) => !existingIds.has(m.id));
            if (toAdd.length > 0) {
              const cacheSnapshot = [
                ...existing.filter((m) => !m.id.startsWith("temp-")),
                ...toAdd,
              ].sort(
                (a, b) =>
                  new Date(a.created_at).getTime() -
                  new Date(b.created_at).getTime()
              );
              msgCache.set(targetId, cacheSnapshot);
            }
            setMessages((prev) => {
              if (communityIdRef.current !== targetId) return prev;
              const prevIds     = new Set(prev.map((m) => m.id));
              const toAddToPrev = incoming.filter((m) => !prevIds.has(m.id));
              if (toAddToPrev.length === 0) return prev;
              const merged = [
                ...prev.filter((m) => !m.id.startsWith("temp-")),
                ...toAddToPrev,
              ].sort(
                (a, b) =>
                  new Date(a.created_at).getTime() -
                  new Date(b.created_at).getTime()
              );
              msgCache.set(targetId, merged);
              return merged;
            });
          } else {
            msgCache.set(targetId, incoming);
            msgFetchedAt.set(targetId, Date.now());
            evictIfNeeded();
            if (communityIdRef.current === targetId) {
              setMessages(incoming);
              // If we got fewer than a full page, there's nothing older to load.
              setHasMoreAbove(incoming.length >= PAGE_SIZE);
            }
          }
        })
        .catch(() => {});
    },
    [communityId, currentUserId]
  );

  // ── Fetch older messages (upward pagination via ?before=ISO) ─────────────
  const fetchOlderMessages = useCallback(
    async (before: string): Promise<void> => {
      if (isFetchingOlderRef.current) return;
      isFetchingOlderRef.current = true;
      setLoadingOlder(true);
      const targetId = communityId;
      try {
        const url = `/api/communities/${targetId}/messages?before=${encodeURIComponent(before)}`;
        const d = await fetchJsonCached<{ messages?: Message[] }>(
          url,
          { staleMs: 30_000 },
          currentUserId,
        );
        if (communityIdRef.current !== targetId) return;
        const incoming: Message[] = d.messages ?? [];
        if (incoming.length < PAGE_SIZE) setHasMoreAbove(false);
        if (incoming.length === 0) return;
        setMessages((prev) => {
          const prevIds = new Set(prev.map((m) => m.id));
          const toAdd   = incoming.filter((m) => !prevIds.has(m.id));
          if (toAdd.length === 0) return prev;
          const merged  = [
            ...toAdd,
            ...prev.filter((m) => !m.id.startsWith("temp-")),
          ].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
          msgCache.set(targetId, merged);
          return merged;
        });
      } catch {
        // Network error — leave state as-is
      } finally {
        isFetchingOlderRef.current = false;
        setLoadingOlder(false);
      }
    },
    [communityId, currentUserId]
  );

  // ── On communityId change: show cache instantly, then catch up ────────────
  useEffect(() => {
    communityIdRef.current = communityId;
    setInitialMessagesReady(false);
    setHasMoreAbove(true);
    isFetchingOlderRef.current = false;
    let cancelled = false;
    const canonicalMessages = getCachedRequest<{ messages?: Message[] }>(
      `/api/communities/${communityId}/messages`,
      currentUserId,
    )?.messages;
    const canonicalMeta = getCachedRequest<{
      community: Community;
      members?: Member[];
    }>(`/api/communities/${communityId}`, currentUserId);
    const cachedMsgs = msgCache.get(communityId) ?? canonicalMessages;
    const cachedMeta = metaCache.get(communityId) ?? (canonicalMeta
      ? {
          community: canonicalMeta.community,
          members: canonicalMeta.members ?? [],
          fetchedAt: Date.now(),
        }
      : undefined);
    setMessages(cachedMsgs ?? []);
    if (cachedMeta) {
      setCommunity(cachedMeta.community);
      setMembers(cachedMeta.members);
      setLoading(false);
    } else {
      setLoading(true);
    }
    const metaIsStale =
      !cachedMeta || Date.now() - cachedMeta.fetchedAt > META_STALE_MS;
    const msgPromise = cachedMsgs?.length
      ? fetchMessages(
          cachedMsgs.filter((m) => !m.id.startsWith("temp-")).at(-1)
            ?.created_at
        )
      : fetchMessages();

    (async () => {
      // Metadata and messages are independent. A transient metadata failure
      // must not leave the chat loader visible forever; the header can still
      // render from the sidebar cache while messages finish loading.
      await Promise.allSettled([
        msgPromise,
        metaIsStale ? fetchMeta() : Promise.resolve(),
      ]);
      if (!cancelled) {
        setLoading(false);
        setInitialMessagesReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId]);

  return {
    community,
    setCommunity,
    members,
    messages,
    loading,
    initialMessagesReady,
    hasMoreAbove,
    loadingOlder,
    setMessages,
    fetchMessages,
    fetchOlderMessages,
    communityIdRef,
    membersRef,
    pendingProfileFetchRef,
  };
}
