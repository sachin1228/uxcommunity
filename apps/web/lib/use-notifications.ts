"use client";

// Shared notifications state — used by the sidebar unread badge and the
// /dashboard/notifications page. Fetches the first page of notifications,
// keeps count/state in sync over the realtime notifications room, and
// mirrors every change into the request cache so other consumers see it.

import { useCallback, useEffect, useState } from "react";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { useHiddenCatchUp } from "@/lib/use-hidden-catchup";
import {
  fetchJsonCached,
  getCachedRequest,
  initRequestCache,
  patchCachedRequest,
  subscribeToRequest,
} from "@/lib/request-cache";

export type NotificationType =
  | "community_thread"
  | "community_resource"
  | "community_event"
  | "thread_comment"
  | "thread_reply"
  | "thread_like"
  | "resource_comment"
  | "resource_reply"
  | "event_comment"
  | "event_reply"
  | "event_rsvp"
  | "event_save"
  | "chat_mention";

export interface NotificationItem {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  href: string;
  read_at: string | null;
  created_at: string;
}

const MAX_ITEMS = 30;

export function useNotifications(userId: string) {
  initRequestCache(userId);
  const isVisible = useDocumentVisible();
  const cached = getCachedRequest<{ notifications?: NotificationItem[]; unread_count?: number }>(
    "/api/notifications",
    userId,
  );
  const [loading, setLoading] = useState(() => !cached);
  const [notifications, setNotifications] = useState<NotificationItem[]>(
    () => cached?.notifications ?? [],
  );
  const [unreadCount, setUnreadCount] = useState(() => cached?.unread_count ?? 0);

  const patchNotificationCache = useCallback(
    (
      update: (
        current: { notifications: NotificationItem[]; unread_count: number },
      ) => { notifications: NotificationItem[]; unread_count: number },
    ) => {
      patchCachedRequest(
        "/api/notifications",
        (current: { notifications?: NotificationItem[]; unread_count?: number }) =>
          update({
            notifications: current.notifications ?? [],
            unread_count: current.unread_count ?? 0,
          }),
        userId,
      );
    },
    [userId],
  );

  const fetchNotifications = useCallback(
    async (force = false) => {
      const data = await fetchJsonCached<{
        notifications?: NotificationItem[];
        unread_count?: number;
      }>(
        "/api/notifications",
        { staleMs: 30_000, force },
        userId,
      );
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unread_count ?? 0);
    },
    [userId],
  );

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetchNotifications()
        .catch((error) => console.error("[notifications] fetch failed", error))
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fetchNotifications]);

  // Catch up when the tab returns after a real absence — the realtime channel
  // is suspended while hidden, so notifications created during that window
  // would otherwise be missed until the next 30s refetch.
  useHiddenCatchUp(() => void fetchNotifications(true).catch(() => {}));

  // Instantly sync every hook instance (sidebar badge, notifications page):
  // when one instance patches the shared cache (mark read, realtime event,
  // refetch), the others re-read it immediately instead of waiting on the
  // realtime worker or the next 30s refetch.
  useEffect(() => {
    return subscribeToRequest(
      "/api/notifications",
      () => {
        const next = getCachedRequest<{
          notifications?: NotificationItem[];
          unread_count?: number;
        }>("/api/notifications", userId);
        if (!next) return;
        setNotifications(next.notifications ?? []);
        setUnreadCount(next.unread_count ?? 0);
      },
      userId,
    );
  }, [userId]);

  useEffect(() => {
    if (!isVisible) return;
    const room = realtimeRooms.notifications(userId);

    const unsubscribes: Array<() => void> = [];
    const unsubRoom = realtimeClient.subscribe(room);

    unsubscribes.push(
      realtimeClient.on(room, "insert", (data) => {
        const next = data as NotificationItem;
        setNotifications((prev) =>
          [next, ...prev.filter((item) => item.id !== next.id)].slice(0, MAX_ITEMS),
        );
        if (!next.read_at) setUnreadCount((count) => count + 1);
        patchNotificationCache((current) => ({
          notifications: [next, ...current.notifications.filter((item) => item.id !== next.id)].slice(0, MAX_ITEMS),
          unread_count: current.unread_count + (next.read_at ? 0 : 1),
        }));
      }),
    );

    unsubscribes.push(
      realtimeClient.on(room, "update", (data) => {
        const { next, old: previous } = data as {
          next: NotificationItem;
          old: Partial<NotificationItem>;
        };
        setNotifications((prev) => prev.map((item) => (item.id === next.id ? next : item)));
        if (!previous.read_at && next.read_at) {
          setUnreadCount((count) => Math.max(0, count - 1));
        }
        patchNotificationCache((current) => ({
          notifications: current.notifications.map((item) => (item.id === next.id ? next : item)),
          unread_count:
            !previous.read_at && next.read_at
              ? Math.max(0, current.unread_count - 1)
              : current.unread_count,
        }));
      }),
    );

    unsubscribes.push(
      realtimeClient.on(room, "delete", (data) => {
        const previous = data as NotificationItem;
        setNotifications((prev) => prev.filter((item) => item.id !== previous.id));
        if (!previous.read_at) setUnreadCount((count) => Math.max(0, count - 1));
        patchNotificationCache((current) => ({
          notifications: current.notifications.filter((item) => item.id !== previous.id),
          unread_count: previous.read_at
            ? current.unread_count
            : Math.max(0, current.unread_count - 1),
        }));
      }),
    );

    realtimeClient.connect();

    return () => {
      unsubscribes.forEach((unsub) => unsub());
      unsubRoom();
    };
  }, [patchNotificationCache, userId, isVisible]);

  const markOneRead = useCallback(
    async (id: string) => {
      const readAt = new Date().toISOString();
      setNotifications((prev) =>
        prev.map((item) => (item.id === id ? { ...item, read_at: item.read_at ?? readAt } : item)),
      );
      setUnreadCount((count) => Math.max(0, count - 1));
      patchNotificationCache((current) => ({
        notifications: current.notifications.map((item) =>
          item.id === id ? { ...item, read_at: item.read_at ?? readAt } : item,
        ),
        unread_count: Math.max(0, current.unread_count - 1),
      }));
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      }).catch((error) => console.error("[notifications] mark read failed", error));
    },
    [patchNotificationCache],
  );

  const markAllRead = useCallback(async () => {
    if (unreadCount <= 0) return;
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((item) => ({ ...item, read_at: item.read_at ?? now })));
    setUnreadCount(0);
    patchNotificationCache((current) => ({
      notifications: current.notifications.map((item) => ({ ...item, read_at: item.read_at ?? now })),
      unread_count: 0,
    }));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch((error) => console.error("[notifications] mark all read failed", error));
  }, [patchNotificationCache, unreadCount]);

  return {
    notifications,
    unreadCount,
    loading,
    markOneRead,
    markAllRead,
  };
}
