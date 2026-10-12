"use client";

import { useCallback, useEffect, useState } from "react";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { useHiddenCatchUp } from "@/lib/use-hidden-catchup";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import {
  fetchJsonCached,
  getCachedRequest,
  initRequestCache,
  patchCachedRequest,
  subscribeToRequest,
} from "@/lib/request-cache";
import { isActivelyReading } from "@/lib/direct-messages/read-manager";
import { dmUrls } from "@/lib/direct-messages/client";

const STALE_MS = 30_000;

/**
 * The topbar Messages badge: the server-side unread total, kept current by
 * the DM realtime stream (which the badge owns while no DM page is open) and
 * invalidated by the read-manager when a conversation is read.
 *
 * Mirrors the notifications bell's cache-sync shape: every instance reads the
 * one request-cache entry, so patching anywhere updates every badge.
 */
export function useDmUnreadBadge(userId: string) {
  initRequestCache(userId);
  const isVisible = useDocumentVisible();

  const [count, setCount] = useState(
    () => getCachedRequest<{ count: number }>(dmUrls.unread, userId)?.count ?? 0,
  );

  const readCount = useCallback(() => {
    const next = getCachedRequest<{ count: number }>(dmUrls.unread, userId);
    if (next) {
      setCount(next.count);
      return true;
    }
    return false;
  }, [userId]);

  // Fetch on mount (cache-first) and on any cache notification.
  useEffect(() => {
    const load = (force: boolean) => {
      void fetchJsonCached<{ count: number }>(dmUrls.unread, { staleMs: STALE_MS, force }, userId)
        .then((data) => setCount(data.count ?? 0))
        .catch(() => {});
    };
    load(false);
    return subscribeToRequest(
      dmUrls.unread,
      () => {
        // The read-manager invalidates the entry before refetching — a
        // deleted entry means "reload", a fresh one means "re-read".
        if (!readCount()) load(true);
      },
      userId,
    );
  }, [userId, readCount]);

  useHiddenCatchUp(() => {
    void fetchJsonCached<{ count: number }>(dmUrls.unread, { staleMs: STALE_MS, force: true }, userId)
      .then((data) => setCount(data.count ?? 0))
      .catch(() => {});
  });

  // Realtime: while no thread is actively being read, every peer message
  // bumps the badge; reading a conversation invalidates the cache and the
  // refetch drops it back.
  useEffect(() => {
    if (!isVisible) return;
    const room = realtimeRooms.dm(userId);

    realtimeClient.init({ id: userId, name: null, avatar: null });
    const unsubRoom = realtimeClient.subscribe(room);
    realtimeClient.connect();

    const unsub = realtimeClient.on(room, "dm-message", (data) => {
      const row = data as { conversation_id?: string; user_id?: string } | null;
      if (!row?.conversation_id || !row.user_id) return;
      if (row.user_id === userId) return;
      if (isActivelyReading(row.conversation_id)) return;

      const current = getCachedRequest<{ count: number }>(dmUrls.unread, userId);
      if (current) {
        patchCachedRequest(
          dmUrls.unread,
          (cached: { count: number }) => ({ count: cached.count + 1 }),
          userId,
        );
      } else {
        void fetchJsonCached<{ count: number }>(dmUrls.unread, { staleMs: STALE_MS, force: true }, userId)
          .then((data) => setCount(data.count ?? 0))
          .catch(() => {});
      }
    });

    return () => {
      unsub();
      unsubRoom();
    };
  }, [userId, isVisible]);

  return count;
}
