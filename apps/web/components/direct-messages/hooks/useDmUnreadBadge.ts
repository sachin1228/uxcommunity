"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useHiddenCatchUp } from "@/lib/use-hidden-catchup";
import { notifyIncomingDirectMessage } from "@/lib/communities/message-notifications";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import {
  fetchJsonCached,
  getCachedRequest,
  initRequestCache,
  subscribeToRequest,
} from "@/lib/request-cache";
import { isActivelyReading } from "@/lib/direct-messages/read-manager";
import { dmUrls } from "@/lib/direct-messages/client";

const STALE_MS = 30_000;

/**
 * The topbar Messages badge: how many conversations have unread peer
 * messages — people who messaged you, not a message sum. Kept current by the
 * DM realtime stream (which the badge owns while no DM page is open) and
 * invalidated by the read-manager when a conversation is read.
 *
 * Mirrors the notifications bell's cache-sync shape: every instance reads the
 * one request-cache entry, so refreshing anywhere updates every badge.
 */
export function useDmUnreadBadge(userId: string) {
  initRequestCache(userId);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // Realtime: a peer message changes the count only when its conversation
  // wasn't already counted, which the badge cannot know from the bare number —
  // so refetch (debounced, so a burst costs one round trip) instead of
  // bumping. Reading a conversation invalidates the cache and refetches too.
  //
  // This subscription deliberately stays open while the tab is hidden: it is
  // what raises the DM browser notification (the bell's room does the same
  // for activity rows). Only the attention-away check in the helper decides
  // whether the OS should interrupt.
  useEffect(() => {
    const room = realtimeRooms.dm(userId);

    realtimeClient.init({ id: userId, name: null, avatar: null });
    const unsubRoom = realtimeClient.subscribe(room);
    realtimeClient.connect();

    const unsub = realtimeClient.on(room, "dm-message", (data) => {
      const row = data as {
        id?: string;
        conversation_id?: string;
        user_id?: string;
        sender_name?: string | null;
        content?: string | null;
        image_url?: string | null;
        reply_to_id?: string | null;
      } | null;
      if (!row?.conversation_id || !row.user_id) return;
      if (row.user_id === userId) return;

      if (row.id) {
        notifyIncomingDirectMessage(userId, {
          id: row.id,
          conversationId: row.conversation_id,
          senderId: row.user_id,
          senderName: row.sender_name ?? null,
          content: row.content ?? "",
          hasImage: !!row.image_url,
          isReply: !!row.reply_to_id,
        });
      }

      if (isActivelyReading(row.conversation_id)) return;

      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(() => {
        refetchTimerRef.current = null;
        void fetchJsonCached<{ count: number }>(dmUrls.unread, { staleMs: STALE_MS, force: true }, userId)
          .then((data) => setCount(data.count ?? 0))
          .catch(() => {});
      }, 600);
    });

    return () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      unsub();
      unsubRoom();
    };
  }, [userId]);

  return count;
}
