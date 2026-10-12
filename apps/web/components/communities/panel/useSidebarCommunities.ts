"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { usePathname } from "next/navigation";
import { useGuardedRouter, refreshPage } from "@/lib/navigation-guard";
import { realtimePool } from "@/lib/realtime/pool";
import {
  sidebarStore,
  setSidebarCommunities,
  updateSidebarCommunities,
  SIDEBAR_STALE_MS,
  initUserCache,
  lastReadAtOnOpen,
  SIDEBAR_CHANGED_EVENT,
  type CachedSidebarCommunity,
} from "@/lib/communities/cache";
import { useSidebarCommunityRows } from "@/lib/communities/cache/use-community-stores";
import {
  fetchJsonCached,
  getCachedRequest,
  initRequestCache,
  setCachedRequest,
} from "@/lib/request-cache";
import { initReadManager, scheduleMarkRead } from "@/lib/communities/read-manager";
import { useHiddenCatchUp } from "@/lib/use-hidden-catchup";
import { useSidebarRealtime, SIDEBAR_REALTIME_LIMIT } from "./useSidebarRealtime";
import { useSidebarTyping } from "./useSidebarTyping";
import { mergeStaleServerList } from "./sidebar-merge";
import { expiredPinIds } from "./sidebar-order";
import { subscribeToNowTick } from "@/lib/use-now-tick";

/**
 * How often the sidebar checks whether a pin has run out. The deadline is the
 * event's start-to-end instant, so a coarse beat is enough to see a room come
 * back down with its neighbours the moment its event does — and the clock is
 * shared, so this costs nothing beyond the badge's own (see use-now-tick).
 */
const PIN_TICK_MS = 15_000;

type Community = CachedSidebarCommunity;

/** The user whose rows are already seeded — the work below runs once per session. */
let seededForUserId: string | null = null;

/**
 * Seeds the sidebar projection on first paint from the request cache, which
 * already holds the last answer inside its stale window — that is what lets the
 * panel paint rows instead of a spinner on a revisit.
 *
 * Runs during render, where the lazy state initializer used to. This is the one
 * write to the store that does not announce itself, and deliberately so: it
 * happens before any subscriber has read the store in this commit, so there is
 * nothing yet to tell.
 */
function seedSidebarStore(userId: string): void {
  if (seededForUserId === userId) return;
  seededForUserId = userId;
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
    // The cache snapshot can predate realtime-applied previews in the store
    // (see sidebar-merge.ts). Never let it demote newer activity on mount.
    const merged = mergeStaleServerList(
      sidebarStore.data?.communities ?? [],
      cached.communities ?? [],
    );
    sidebarStore.data = { communities: merged, fetchedAt: Date.now() };
  }
}

export function useSidebarCommunities(userId: string) {
  const router   = useGuardedRouter();
  const pathname = usePathname();

  // Initialize the realtime pool with the current user on first mount.
  // This must happen before any component calls realtimePool.acquire().
  //
  // init() only — and that is deliberate. This hook does not own the realtime
  // client, and `destroyAll()` tears down the app-wide singleton: every room and
  // every socket, including ones registered by other components (the chat's
  // rooms, the right sidebar's rules room, the notification bell's socket).
  // Running it from an effect cleanup meant an unmount here — including the
  // unmount half of React's StrictMode double-invoke, which is exactly the
  // stack in the dev console — closed sockets those hooks still depended on and
  // dropped room state out from under handlers that stayed registered. Session
  // end is what should tear the client down, so that now lives in the logout
  // flow (components/ui/useLogout.ts).
  useEffect(() => {
    realtimePool.init({ id: userId, name: null, avatar: null });
  }, [userId]);

  const activeCommunityId = pathname.match(
    /\/dashboard\/communities\/([^/]+)/
  )?.[1];

  seedSidebarStore(userId);

  // The rows are the shared store's rows, not a copy: realtime previews,
  // mark-read patches, joins and leaves all write that one list, and this hook
  // re-renders with whatever is in it. Component state is only for what the
  // server has not answered yet.
  const communities = useSidebarCommunityRows();
  const [settled, setSettled] = useState(() => sidebarStore.data !== null);
  const loading = !settled && communities.length === 0;

  const activeCommunityIdRef = useRef(activeCommunityId);

  // The request cache owns freshness and in-flight deduplication. sidebarStore is
  // retained as the realtime/optimistic projection consumed by existing hooks.
  const load = useCallback(async (force = false) => {
    try {
      const data = await fetchJsonCached<{ communities?: Community[] }>(
        "/api/communities",
        { staleMs: SIDEBAR_STALE_MS, force },
        userId,
      );
      const fresh = data.communities ?? [];
      // Merge, don't replace: a cache-hit response can be older per-community
      // than what realtime already applied to the store (its entry is
      // re-stamped by every mark-read patch). Replacing here is the bug that
      // sank a just-messaged community back down the list on the next open.
      const merged = mergeStaleServerList(sidebarStore.data?.communities ?? [], fresh);
      setSidebarCommunities(merged);
    } catch (error) {
      console.error("[communities] fetch failed", error);
    } finally {
      setSettled(true);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime subscriptions are suspended while the tab is hidden (see
  // useSidebarRealtime) and the sockets don't replay missed events, so a
  // regain must refetch to catch up unread counts and previews missed while
  // hidden (force bypasses the 60s stale window). useHiddenCatchUp fires this
  // only after a real absence — rapid alt-tabbing no longer issues a refetch
  // per focus event.
  useHiddenCatchUp(() => void load(true));

  // While there are more communities than the realtime cap keeps live, poll
  // the sidebar on the request cache's stale window so communities outside
  // the live socket set still get fresh previews and unread counts. Users at
  // or under the cap keep every community live via realtime and never poll.
  const overRealtimeLimit = communities.length > SIDEBAR_REALTIME_LIMIT;
  useEffect(() => {
    if (!overRealtimeLimit) return;
    const timer = window.setInterval(() => {
      void load();
    }, SIDEBAR_STALE_MS);
    return () => window.clearInterval(timer);
  }, [overRealtimeLimit, load]);

  // ── Pins whose deadline has passed ────────────────────────────────────────
  // `pinned_until` is an instant (the event's end), and the server only sends
  // it while that instant is ahead — but the value it already sent stays in the
  // store until the next fetch replaces it. So a room outlived its own pin: it
  // kept the mark and its place above busier communities until a refetch
  // happened to land. Expiring it here, on the shared clock, is what makes the
  // pin turn over with the event rather than with the next request — and it is
  // a write to the store, not to component state, because the store is what
  // every consumer reads (the rows, the ordering, the chat's own fallback).
  // That is also why the work hangs off the clock's callback rather than off a
  // render: same shape as the realtime handlers below.
  useEffect(
    () =>
      subscribeToNowTick((nowMs) => {
        const expired = expiredPinIds(sidebarStore.data?.communities ?? [], nowMs);
        if (!expired.length) return;
        const expiredSet = new Set(expired);
        const clearPin = (c: Community): Community =>
          expiredSet.has(c.id) ? { ...c, pinned_until: null } : c;

        // The store and the cached snapshot are cleared together (one writer
        // does both), so a stale-window replay of /api/communities cannot
        // restore a pin that has run out.
        updateSidebarCommunities((current) => current.map(clearPin));
      }, PIN_TICK_MS),
    [userId],
  );

  // Re-fetch whenever a join/leave/archive action fires the sidebar-changed
  // event. The rows themselves need no syncing here: they are the store's, and
  // the store's own change event already re-rendered them.
  useEffect(() => {
    const handler = () => void load();
    window.addEventListener(SIDEBAR_CHANGED_EVENT, handler);
    return () => window.removeEventListener(SIDEBAR_CHANGED_EVENT, handler);
  }, [load]);

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
        updateSidebarCommunities((current) =>
          current.map((c) =>
            c.id === activeCommunityId ? { ...c, last_read_at: optimisticReadAt } : c,
          ),
        );
      }
    }

    scheduleMarkRead(activeCommunityId, {
      unreadCount: snapshot?.message_count ?? null,
      contentUnreadCount: snapshot?.unread_content_count ?? null,
      lastMessageTimestamp: snapshot?.last_message?.created_at ?? null,
      reason: "community opened",
      // User-initiated open: must clear the badge even when a realtime
      // mark-read for this community fired within the last 30s.
      bypassCooldown: true,
    });

    // Zero the badges on the shared rows (the optimistic read stamp above is
    // already on them — there is no second base to copy it back from).
    updateSidebarCommunities((current) =>
      current.map((c) =>
        c.id === activeCommunityId
          ? { ...c, message_count: 0, mention_count: 0, unread_content_count: 0 }
          : c,
      ),
    );
  }, [activeCommunityId]);

  // ── Realtime: message changes + typing indicators ────────────────────────
  useSidebarRealtime({
    communities,
    userId,
    activeCommunityIdRef,
    updateCommunities: updateSidebarCommunities,
  });
  const typingMap = useSidebarTyping({ communities, userId });

  // ── Navigation handler ────────────────────────────────────────────────────
  // useCallback keeps the identity stable across renders so the memoized
  // CommunityRow rows don't re-render on unrelated state churn (typing
  // indicators, message previews, unread badges). The guarded router is
  // recreated on navigation — the only time the rows legitimately need a
  // refresh anyway.
  const handleNavigate = useCallback((id: string) => {
    const target = `/dashboard/communities/${id}`;
    // Re-clicking the community that is already open refreshes it — the same
    // re-click gesture the sidebar's nav links perform for their own pages
    // (see `refreshPage`). The badge work below belongs to opening a
    // community that is not on screen.
    if (pathname === target) {
      refreshPage(target);
      return;
    }

    // Read the pre-zero snapshot first; the optimistic badge clearing below
    // would otherwise make the manager think there is nothing to mark read.
    const snapshot = sidebarStore.data?.communities.find((c) => c.id === id);

    if (!lastReadAtOnOpen.has(id)) {
      if (snapshot) {
        lastReadAtOnOpen.set(id, snapshot.last_read_at ?? null);
        const optimisticReadAt = new Date().toISOString();
        updateSidebarCommunities((current) =>
          current.map((c) => (c.id === id ? { ...c, last_read_at: optimisticReadAt } : c)),
        );
      }
    }

    scheduleMarkRead(id, {
      unreadCount: snapshot?.message_count ?? null,
      contentUnreadCount: snapshot?.unread_content_count ?? null,
      lastMessageTimestamp: snapshot?.last_message?.created_at ?? null,
      reason: "sidebar navigation",
      // User-initiated open: must clear the badge even when a realtime
      // mark-read for this community fired within the last 30s.
      bypassCooldown: true,
    });

    // Zero the badges on the shared rows — one base, so the optimistic read
    // stamp written above survives without being copied back from the store.
    updateSidebarCommunities((current) =>
      current.map((c) =>
        c.id === id
          ? { ...c, message_count: 0, mention_count: 0, unread_content_count: 0 }
          : c,
      ),
    );

    router.push(target);
  }, [pathname, router]);

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
