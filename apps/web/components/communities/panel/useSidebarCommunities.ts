"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  sidebarStore,
  SIDEBAR_STALE_MS,
  initUserCache,
  lastReadAtOnOpen,
  SIDEBAR_CHANGED_EVENT,
  type CachedSidebarCommunity,
} from "@/lib/communities/cache";
import { fetchJsonCached } from "@/lib/request-cache";
import { markReadOnServer } from "./markReadOnServer";
import { useSidebarRealtime } from "./useSidebarRealtime";
import { useSidebarTyping } from "./useSidebarTyping";

type Community = CachedSidebarCommunity;

export function useSidebarCommunities(userId: string) {
  const router   = useRouter();
  const pathname = usePathname();

  const activeCommunityId = pathname.match(
    /\/dashboard\/communities\/([^/]+)/
  )?.[1];

  const [communities, setCommunities] = useState<Community[]>(() => {
    initUserCache(userId);
    return sidebarStore.data?.communities ?? [];
  });
  const [loading, setLoading] = useState(() => sidebarStore.data === null);

  const activeCommunityIdRef = useRef(activeCommunityId);

  // ── Shared, user-scoped communities load ──────────────────────────────────
  const load = useCallback((force = false) => {
    if (
      !force &&
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
    const p: Promise<void> = fetchJsonCached<{ communities?: CachedSidebarCommunity[] }>(
      "/api/communities",
      {
        staleMs: SIDEBAR_STALE_MS,
        force,
        source: "communities-sidebar",
        reason: force ? "membership changed" : "initial sidebar load",
      },
      userId,
    )
      .then((data) => {
        const fresh = data.communities ?? [];
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
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  // Re-fetch whenever a join/leave/archive action fires the sidebar-changed event
  useEffect(() => {
    const handler = () => {
      setCommunities(sidebarStore.data?.communities ?? []);
      setLoading(sidebarStore.data === null);
      load(true);
    };
    window.addEventListener(SIDEBAR_CHANGED_EVENT, handler);
    return () => window.removeEventListener(SIDEBAR_CHANGED_EVENT, handler);
  }, [load]);

  // Header actions update the module-level cache because the global sidebar
  // stays mounted while the community route changes.
  useEffect(() => {
    const syncFromCache = () => {
      if (sidebarStore.data) {
        setCommunities(sidebarStore.data.communities);
      } else {
        // Cache was invalidated (e.g. community created/joined/left) — re-fetch.
        load(true);
      }
    };
    window.addEventListener(SIDEBAR_CHANGED_EVENT, syncFromCache);
    return () => window.removeEventListener(SIDEBAR_CHANGED_EVENT, syncFromCache);
  }, [load]);

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

  // ── Realtime: message changes + typing indicators ────────────────────────
  useSidebarRealtime({ communities, userId, activeCommunityIdRef, setCommunities });
  const typingMap = useSidebarTyping({ communities, userId });

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
    communities: communities.filter((c) => !c.is_archived),
    loading,
    activeCommunityId,
    typingMap,
    handleNavigate,
    pathname,
    router,
  };
}
