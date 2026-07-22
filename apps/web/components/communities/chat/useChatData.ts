"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import {
  msgCache,
  metaCache,
  msgFetchedAt,
  inFlightMsgFetch,
  evictIfNeeded,
  META_STALE_MS,
  type CachedMessage,
  type CachedMeta,
} from "@/lib/communities/cache";

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

export interface Community {
  id: string;
  name: string;
  type: string;
  member_count: number;
  image_url: string | null;
}

export interface Member {
  user_id: string;
  users: { name: string; avatar_url: string | null } | null;
}

type Message = CachedMessage;

interface UseChatDataOptions {
  communityId: string;
  initialMeta?: CachedMeta;
  initialMessages?: CachedMessage[];
  /** Called once on mount if SSR provided a lastReadAt and no cached messages exist. */
  onSeedLastReadAt?: (val: string | null) => void;
  /** Called once hasMounted should be set to true (first layout effect). */
  onMounted?: () => void;
}

export function useChatData({
  communityId,
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

  const communityIdRef         = useRef(communityId);
  const membersRef             = useRef(members);
  const pendingProfileFetchRef = useRef<Map<string, Promise<void>>>(new Map());

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
      setCommunity(initialMeta.community);
      setMembers(initialMeta.members);
    }
    if (cachedMsgs?.length) {
      setMessages(cachedMsgs);
    } else if (initialMessages?.length) {
      msgCache.set(communityId, initialMessages);
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
    const res = await fetch(`/api/communities/${targetId}`);
    if (!res.ok) return;
    const d = await res.json();
    if (communityIdRef.current !== targetId) return;
    const cached: CachedMeta = {
      community: d.community,
      members: d.members ?? [],
      fetchedAt: Date.now(),
    };
    metaCache.set(targetId, cached);
    setCommunity(d.community);
    setMembers(d.members ?? []);
  }, [communityId]);

  // ── Fetch messages (full or incremental via ?after=ISO) ───────────────────
  const fetchMessages = useCallback(
    (after?: string): Promise<void> => {
      const targetId = communityId;
      if (!after) {
        const inflight = inFlightMsgFetch.get(targetId);
        if (inflight) {
          return inflight.then(() => {
            const cached = msgCache.get(targetId);
            if (communityIdRef.current === targetId && cached?.length)
              setMessages(cached);
          });
        }
      }
      const url = after
        ? `/api/communities/${targetId}/messages?after=${encodeURIComponent(after)}`
        : `/api/communities/${targetId}/messages`;

      const p: Promise<void> = fetch(url)
        .then((res) => (res.ok ? res.json() : undefined))
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
            if (communityIdRef.current === targetId) setMessages(incoming);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!after) inFlightMsgFetch.delete(targetId);
        });

      if (!after) inFlightMsgFetch.set(targetId, p);
      return p;
    },
    [communityId]
  );

  // ── On communityId change: show cache instantly, then catch up ────────────
  useEffect(() => {
    communityIdRef.current = communityId;
    setInitialMessagesReady(false);
    let cancelled = false;
    const cachedMsgs = msgCache.get(communityId);
    const cachedMeta = metaCache.get(communityId);
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
      await Promise.all([
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
    members,
    messages,
    loading,
    initialMessagesReady,
    setMessages,
    fetchMessages,
    communityIdRef,
    membersRef,
    pendingProfileFetchRef,
  };
}
