"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { useGuardedRouter } from "@/lib/navigation-guard";
import {
  sidebarStore,
  SIDEBAR_STALE_MS,
  initUserCache,
  lastReadAtOnOpen,
  SIDEBAR_CHANGED_EVENT,
  SIDEBAR_MESSAGE_CHANGED_EVENT,
  SIDEBAR_REACTION_CHANGED_EVENT,
  type CachedSidebarCommunity,
} from "@/lib/communities/cache";
import {
  fetchJsonCached,
  getCachedRequest,
  initRequestCache,
  setCachedRequest,
} from "@/lib/request-cache";
import { initReadManager, scheduleMarkRead } from "@/lib/communities/read-manager";
import { useHiddenCatchUp } from "@/lib/use-hidden-catchup";
import { useSidebarRealtime } from "./useSidebarRealtime";
import { useSidebarTyping } from "./useSidebarTyping";

type Community = CachedSidebarCommunity;

export function useSidebarCommunities(userId: string) {
  const router   = useGuardedRouter();
  const pathname = usePathname();

  const activeCommunityId = pathname.match(
    /\/dashboard\/communities\/([^/]+)/
  )?.[1];

  const [communities, setCommunities] = useState<Community[]>(() => {
    initUserCache(userId);
    initReadManager(userId);
    initRequestCache(userId);
    if (
      sidebarStore.data &&
      Date.now() - sidebarStore.data.fetchedAt < SIDEBAR_STALE_MS &&
      !getCachedRequest("/api/communities", userId)
    ) {
      setCachedRequest(
        "/api/communities",
        { communities: sidebarStore.data.communities },
        userId,
      );
    }
    const cached = getCachedRequest<{ communities?: Community[] }>("/api/communities", userId);
    if (cached) {
      sidebarStore.data = { communities: cached.communities ?? [], fetchedAt: Date.now() };
    }
    return sidebarStore.data?.communities ?? [];
  });
  const [loading, setLoading] = useState(() => sidebarStore.data === null);

  const activeCommunityIdRef = useRef(activeCommunityId);

  // The request cache owns freshness and in-flight deduplication. sidebarStore is
  // retained as the realtime/optimistic projection consumed by existing hooks.
  const load = useCallback(async (force = false) => {
    if (!sidebarStore.data) setLoading(true);
    try {
      const data = await fetchJsonCached<{ communities?: Community[] }>(
        "/api/communities",
        { staleMs: SIDEBAR_STALE_MS, force },
        userId,
      );
      const fresh = data.communities ?? [];
      sidebarStore.data = { communities: fresh, fetchedAt: Date.now() };
      setCommunities(fresh);
    } catch (error) {
      console.error("[communities] fetch failed", error);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime channels are suspended while the tab is hidden (see
  // useSidebarRealtime) and the panel room doesn't replay missed events, so a
  // regain must refetch to catch up unread counts and previews missed while
  // hidden (force bypasses the 60s stale window). useHiddenCatchUp fires this
  // only after a real absence — rapid alt-tabbing no longer issues a refetch
  // per focus event.
  useHiddenCatchUp(() => void load(true));

  // Re-fetch whenever a join/leave/archive action fires the sidebar-changed event
  useEffect(() => {
    const handler = () => {
      setCommunities(sidebarStore.data?.communities ?? []);
      setLoading(sidebarStore.data === null);
      load();
    };
    window.addEventListener(SIDEBAR_CHANGED_EVENT, handler);
    return () => window.removeEventListener(SIDEBAR_CHANGED_EVENT, handler);
  }, [load]);

  // Local reaction preview patches (from the chat window) must only sync the
  // store into React state. Refetching here would replace the optimistic
  // "You reacted …" preview with the stale /api/communities cache that
  // predates the reaction — the exact bug where reacting to a message left
  // the sidebar showing the old preview (or "No messages yet").
  useEffect(() => {
    const handler = () => {
      setCommunities(sidebarStore.data?.communities ?? []);
    };
    window.addEventListener(SIDEBAR_REACTION_CHANGED_EVENT, handler);
    return () => window.removeEventListener(SIDEBAR_REACTION_CHANGED_EVENT, handler);
  }, []);

  // Optimistic last-message patches (the sender's own chat sends) must also
  // only sync the store into React state — refetching would clobber the
  // optimistic "You: …" preview with the stale /api/communities cache that
  // predates the send, sinking the community back down the list.
  useEffect(() => {
    const handler = () => {
      setCommunities(sidebarStore.data?.communities ?? []);
    };
    window.addEventListener(SIDEBAR_MESSAGE_CHANGED_EVENT, handler);
    return () => window.removeEventListener(SIDEBAR_MESSAGE_CHANGED_EVENT, handler);
  }, []);

  // ── Active community change: clear badge + mark read ─────────────────────
  useEffect(() => {
    activeCommunityIdRef.current = activeCommunityId;
    if (!activeCommunityId) return;

    // Capture the pre-zero unread snapshot BEFORE any optimistic updates so the
    // read manager can decide whether a PATCH is actually needed.
    const snapshot = sidebarStore.data?.communities.find(
      (c) => c.id === activeCommunityId
    );

    if (!lastReadAtOnOpen.has(activeCommunityId)) {
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
    }

    scheduleMarkRead(activeCommunityId, {
      unreadCount: snapshot?.message_count ?? null,
      lastMessageTimestamp: snapshot?.last_message?.created_at ?? null,
      reason: "community opened",
    });

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
    // Read the pre-zero snapshot first; the optimistic badge clearing below
    // would otherwise make the manager think there is nothing to mark read.
    const snapshot = sidebarStore.data?.communities.find((c) => c.id === id);

    if (!lastReadAtOnOpen.has(id)) {
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

    scheduleMarkRead(id, {
      unreadCount: snapshot?.message_count ?? null,
      lastMessageTimestamp: snapshot?.last_message?.created_at ?? null,
      reason: "sidebar navigation",
    });

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
