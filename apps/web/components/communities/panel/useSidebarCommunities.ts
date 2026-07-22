"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createBrowserClient } from "@/lib/supabase/browser";
import {
  sidebarStore,
  SIDEBAR_STALE_MS,
  initUserCache,
  lastReadAtOnOpen,
  type CachedSidebarCommunity,
} from "@/lib/communities/cache";
import { usePrefetch } from "./usePrefetch";
import { markReadOnServer } from "./markReadOnServer";

type Community = CachedSidebarCommunity;

export function useSidebarCommunities(userId: string) {
  const router   = useRouter();
  const pathname = usePathname();
  const { onEnter, onLeave } = usePrefetch();

  const activeCommunityId = pathname.match(
    /\/dashboard\/communities\/([^/]+)/
  )?.[1];

  const [communities, setCommunities] = useState<Community[]>(() => {
    initUserCache(userId);
    return sidebarStore.data?.communities ?? [];
  });
  const [loading, setLoading] = useState(() => sidebarStore.data === null);

  const activeCommunityIdRef = useRef(activeCommunityId);
  const revalidateInFlight   = useRef(false);

  // ── Stale-while-revalidate load ──────────────────────────────────────────
  const load = useCallback(() => {
    if (
      sidebarStore.data &&
      Date.now() - sidebarStore.data.fetchedAt < SIDEBAR_STALE_MS
    ) {
      setLoading(false);
      return;
    }
    if (sidebarStore.inflight) {
      sidebarStore.inflight.then(() => {
        if (sidebarStore.data) setCommunities(sidebarStore.data.communities);
        setLoading(false);
      });
      if (sidebarStore.data) setLoading(false);
      return;
    }
    const p: Promise<void> = fetch("/api/communities")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!d) return;
        const fresh = d.communities ?? [];
        sidebarStore.data = { communities: fresh, fetchedAt: Date.now() };
        setCommunities(fresh);
      })
      .catch(() => {})
      .finally(() => {
        sidebarStore.inflight = null;
        setLoading(false);
      });
    sidebarStore.inflight = p;
    if (sidebarStore.data) setLoading(false);
  }, []);

  // ── Background unread-count reconciliation ───────────────────────────────
  const revalidateUnreadCounts = useCallback(() => {
    if (revalidateInFlight.current) return;
    revalidateInFlight.current = true;
    fetch("/api/communities")
      .then((res) => (res.ok ? res.json() : null))
      .then((d) => {
        if (!d?.communities) return;
        const fresh: CachedSidebarCommunity[] = d.communities;
        setCommunities((prev) => {
          const prevMap   = new Map(prev.map((c) => [c.id, c]));
          const storeById = new Map(
            (sidebarStore.data?.communities ?? []).map((c) => [c.id, c])
          );
          const currentActiveId = activeCommunityIdRef.current;
          const merged = fresh.map((server) => {
            const local    = prevMap.get(server.id);
            const stored   = storeById.get(server.id);
            const serverMs = server.last_read_at
              ? new Date(server.last_read_at).getTime()
              : -Infinity;
            const storedMs = stored?.last_read_at
              ? new Date(stored.last_read_at).getTime()
              : -Infinity;
            const bestLastReadAt =
              !stored?.last_read_at || serverMs >= storedMs
                ? server.last_read_at
                : stored.last_read_at;
            return {
              ...server,
              last_read_at: bestLastReadAt,
              message_count:
                server.id === currentActiveId
                  ? 0
                  : Math.max(server.message_count, local?.message_count ?? 0),
            };
          });
          if (sidebarStore.data) {
            sidebarStore.data = {
              ...sidebarStore.data,
              communities: merged,
              fetchedAt: Date.now(),
            };
          }
          return merged;
        });
      })
      .catch(() => {})
      .finally(() => {
        revalidateInFlight.current = false;
      });
  }, []);

  useEffect(() => {
    const cacheWasFresh =
      !!sidebarStore.data &&
      Date.now() - sidebarStore.data.fetchedAt < SIDEBAR_STALE_MS;
    load();
    if (cacheWasFresh) revalidateUnreadCounts();
  }, [load, revalidateUnreadCounts]);

  // ── Active community change: clear badge + mark read ─────────────────────
  useEffect(() => {
    activeCommunityIdRef.current = activeCommunityId;
    if (!activeCommunityId) return;

    if (!lastReadAtOnOpen.has(activeCommunityId)) {
      const snapshot = sidebarStore.data?.communities.find(
        (c) => c.id === activeCommunityId
      );
      if (snapshot) {
        lastReadAtOnOpen.set(activeCommunityId, snapshot.last_read_at ?? null);
        const optimisticReadAt = new Date().toISOString();
        if (sidebarStore.data) {
          sidebarStore.data = {
            ...sidebarStore.data,
            communities: sidebarStore.data.communities.map((c) =>
              c.id === activeCommunityId
                ? { ...c, last_read_at: optimisticReadAt }
                : c
            ),
          };
        }
      }
      markReadOnServer(activeCommunityId);
    }

    setCommunities((prev) => {
      const updated = prev.map((c) =>
        c.id === activeCommunityId ? { ...c, message_count: 0 } : c
      );
      if (sidebarStore.data) {
        const storeById = new Map(
          sidebarStore.data.communities.map((c) => [c.id, c])
        );
        sidebarStore.data = {
          ...sidebarStore.data,
          communities: updated.map((c) => ({
            ...c,
            last_read_at: storeById.get(c.id)?.last_read_at ?? c.last_read_at,
          })),
        };
      }
      return updated;
    });
  }, [activeCommunityId]);

  // ── Realtime subscriptions — one channel per joined community ────────────
  const communityIds = [...communities].map((c) => c.id).sort().join(",");
  useEffect(() => {
    if (!communities.length) return;
    let supabase: ReturnType<typeof createBrowserClient>;
    try {
      supabase = createBrowserClient();
    } catch {
      return;
    }

    const channels = communities.map((comm) =>
      supabase
        .channel(`panel:${comm.id}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "community_messages",
            filter: `community_id=eq.${comm.id}`,
          },
          (payload) => {
            const row = payload.new as {
              id: string;
              community_id: string;
              content: string;
              created_at: string;
              user_id: string;
            };
            const isOwn    = row.user_id === userId;
            const isActive = row.community_id === activeCommunityIdRef.current;

            setCommunities((prev) => {
              const updated = prev.map((c) =>
                c.id === row.community_id
                  ? {
                      ...c,
                      last_message: {
                        content: row.content,
                        created_at: row.created_at,
                        user: c.last_message?.user ?? null,
                      },
                      message_count:
                        !isOwn && !isActive
                          ? c.message_count + 1
                          : c.message_count,
                    }
                  : c
              );
              if (sidebarStore.data) {
                const storeById = new Map(
                  sidebarStore.data.communities.map((c) => [c.id, c])
                );
                sidebarStore.data = {
                  ...sidebarStore.data,
                  communities: updated.map((c) => ({
                    ...c,
                    last_read_at:
                      storeById.get(c.id)?.last_read_at ?? c.last_read_at,
                  })),
                };
              }
              return updated;
            });
          }
        )
        .subscribe()
    );

    return () => {
      channels.forEach((ch) => supabase.removeChannel(ch));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityIds, userId]);

  // ── Navigation handler ────────────────────────────────────────────────────
  function handleNavigate(id: string) {
    if (!lastReadAtOnOpen.has(id)) {
      const snapshot = sidebarStore.data?.communities.find((c) => c.id === id);
      if (snapshot) {
        lastReadAtOnOpen.set(id, snapshot.last_read_at ?? null);
        const optimisticReadAt = new Date().toISOString();
        if (sidebarStore.data) {
          sidebarStore.data = {
            ...sidebarStore.data,
            communities: sidebarStore.data.communities.map((c) =>
              c.id === id ? { ...c, last_read_at: optimisticReadAt } : c
            ),
          };
        }
      }
    }

    setCommunities((prev) => {
      const updated = prev.map((c) =>
        c.id === id ? { ...c, message_count: 0 } : c
      );
      if (sidebarStore.data) {
        const storeById = new Map(
          sidebarStore.data.communities.map((c) => [c.id, c])
        );
        sidebarStore.data = {
          ...sidebarStore.data,
          communities: updated.map((c) => ({
            ...c,
            last_read_at: storeById.get(c.id)?.last_read_at ?? c.last_read_at,
          })),
        };
      }
      return updated;
    });

    router.push(`/dashboard/communities/${id}`);
    void markReadOnServer(id);
  }

  return {
    communities,
    loading,
    activeCommunityId,
    handleNavigate,
    onEnter,
    onLeave,
    pathname,
    router,
  };
}
