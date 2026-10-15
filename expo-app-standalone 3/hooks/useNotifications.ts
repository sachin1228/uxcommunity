/**
 * Notifications state — used by the header bell badge and the notifications
 * screen. Port of the web hook `apps/web/lib/use-notifications.ts` onto the
 * React Native realtime client.
 *
 * Two counts come out of it, exactly like the web:
 *   - `unreadCount`  — server truth: rows with read_at null.
 *   - `unseenCount`  — what the badge shows: unread rows created after the
 *     member last opened the list (the shared seen watermark).
 *
 * Realtime: the `notifications:${userId}` room multiplexes over the user's
 * one user-scoped WebSocket; topics `insert` / `update` / `delete` carry the
 * notification row. Every mutation is atomic on one state object so an echo of
 * our own optimistic mark-read cannot decrement the unread count twice.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { useAuth } from '@/context/AuthContext';
import { realtimeClient, realtimeRooms } from '@/lib/realtime';
import {
  MAX_NOTIFICATION_ITEMS,
  countUnseenSince,
  newestCreatedAt,
  type NotificationItem,
} from '@/lib/notifications';
import {
  forgetNotificationsPage,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  patchNotificationsPage,
  peekNotificationsPage,
} from '@/lib/notificationsApi';
import { notificationsSeen } from '@/lib/notificationsSeen';

interface NotificationsState {
  notifications: NotificationItem[];
  unreadCount: number;
}

const EMPTY_STATE: NotificationsState = { notifications: [], unreadCount: 0 };

interface UseNotificationsOptions {
  /**
   * True on the notifications screen: while it is mounted every change to the
   * loaded list advances the seen watermark to its newest item, so the bell
   * badge reads zero while the list is on screen — and starts from one for
   * anything that arrives after the member leaves. read_at is never touched.
   */
  autoMarkSeen?: boolean;
}

export function useNotifications(options: UseNotificationsOptions = {}) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { autoMarkSeen = false } = options;

  const [state, setState] = useState<NotificationsState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);
  const [seenAt, setSeenAt] = useState<string | null>(null);
  // The badge waits for the persisted watermark before it renders its count,
  // so a cold start never flashes the all-time unread total first.
  const [seenLoaded, setSeenLoaded] = useState(false);

  /** Skips duplicate refetches from overlapping reconnect/foreground edges. */
  const fetchingRef = useRef(false);
  /** Timestamp of the last settled fetch — the freshness guard for catch-ups. */
  const lastFetchAtRef = useRef(0);

  const fetchNotifications = useCallback(
    async (options: { silent?: boolean } = {}) => {
      if (!userId) return;
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      if (!options.silent) setLoading(true);
      try {
        const page = await getNotifications(userId);
        setState({ notifications: page.notifications, unreadCount: page.unreadCount });
        lastFetchAtRef.current = Date.now();
      } catch {
        // Keep whatever is on screen; the next catch-up or pull-to-refresh retries.
      } finally {
        fetchingRef.current = false;
        if (!options.silent) setLoading(false);
      }
    },
    [userId],
  );

  /** Reconnect/foreground recovery — one request, never a poll loop. */
  const catchUp = useCallback(() => {
    if (Date.now() - lastFetchAtRef.current < 5_000) return;
    void fetchNotifications({ silent: true });
  }, [fetchNotifications]);

  /**
   * One mutation path for local state AND the shared page cache, so a header
   * instance mounting moments later seeds from the same truth (web equivalent:
   * patchCachedRequest). The updater must be pure — it runs once per store.
   */
  const applyMutation = useCallback(
    (update: (current: NotificationsState) => NotificationsState) => {
      setState(update);
      if (userId) {
        patchNotificationsPage(userId, (page) => {
          const next = update({
            notifications: page.notifications,
            unreadCount: page.unreadCount,
          });
          return { notifications: next.notifications, unreadCount: next.unreadCount };
        });
      }
    },
    [userId],
  );

  // Session identity change resets everything the previous account had.
  useEffect(() => {
    setState(EMPTY_STATE);
    setLoading(Boolean(userId));
    setSeenAt(null);
    setSeenLoaded(false);
    lastFetchAtRef.current = 0;
    if (!userId) {
      forgetNotificationsPage();
      return;
    }

    // A page another instance (a tab's header) fetched moments ago seeds this
    // instance; otherwise fetch. Either way the realtime room keeps it live.
    const cached = peekNotificationsPage(userId);
    if (cached) {
      setState({ notifications: cached.notifications, unreadCount: cached.unreadCount });
      lastFetchAtRef.current = Date.now();
      setLoading(false);
    } else {
      void fetchNotifications();
    }

    setSeenAt(notificationsSeen.read(userId));
    const unsubscribe = notificationsSeen.subscribe(() =>
      setSeenAt(notificationsSeen.read(userId)),
    );
    void notificationsSeen.hydrate(userId).then(() => setSeenLoaded(true));
    return unsubscribe;
  }, [userId, fetchNotifications]);

  // On the notifications screen, being looked at is what clears the badge:
  // each change to the visible list advances the watermark past everything in
  // it (the store's monotonic guard keeps it from going backwards). Arrivals
  // show up in the list without bumping the badge while the screen is open.
  useEffect(() => {
    if (!autoMarkSeen || !userId) return;
    const newest = newestCreatedAt(state.notifications);
    if (newest !== null) notificationsSeen.advance(userId, newest);
  }, [autoMarkSeen, state.notifications, userId]);

  useEffect(() => {
    if (!userId) return;

    realtimeClient.init({ id: userId, name: user?.name ?? null, avatar: null });
    const room = realtimeRooms.notifications(userId);
    realtimeClient.connect(room);

    const unsubscribes: Array<() => void> = [];

    unsubscribes.push(
      realtimeClient.on(room, 'insert', (data) => {
        const next = data as NotificationItem;
        if (!next?.id) return;
        applyMutation((current) => ({
          notifications: [
            next,
            ...current.notifications.filter((item) => item.id !== next.id),
          ].slice(0, MAX_NOTIFICATION_ITEMS),
          unreadCount: current.unreadCount + (next.read_at ? 0 : 1),
        }));
      }),
    );

    unsubscribes.push(
      realtimeClient.on(room, 'update', (data) => {
        const { next } = data as { next: NotificationItem };
        if (!next?.id) return;
        applyMutation((current) => {
          const local = current.notifications.find((item) => item.id === next.id);
          // Decrement only when the local copy was still unread — an echo of
          // our own optimistic mark-read must not count the same row twice.
          const shouldDecrement = Boolean(local && !local.read_at && next.read_at);
          return {
            notifications: current.notifications.map((item) =>
              item.id === next.id ? next : item,
            ),
            unreadCount: shouldDecrement
              ? Math.max(0, current.unreadCount - 1)
              : current.unreadCount,
          };
        });
      }),
    );

    unsubscribes.push(
      realtimeClient.on(room, 'delete', (data) => {
        const removed = data as NotificationItem;
        if (!removed?.id) return;
        applyMutation((current) => {
          const local = current.notifications.find((item) => item.id === removed.id);
          return {
            notifications: current.notifications.filter((item) => item.id !== removed.id),
            unreadCount:
              local && !local.read_at
                ? Math.max(0, current.unreadCount - 1)
                : current.unreadCount,
          };
        });
      }),
    );

    // Once this socket is up it will not miss anything; whatever was published
    // while it was down is recovered with one catch-up request.
    unsubscribes.push(realtimeClient.onRoomStatus(room, (connected) => {
      if (connected) catchUp();
    }));

    const appStateSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') catchUp();
    });

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      appStateSub.remove();
    };
  }, [userId, user?.name, catchUp, applyMutation]);

  const markOneRead = useCallback(async (id: string) => {
    const readAt = new Date().toISOString();
    applyMutation((current) => {
      const item = current.notifications.find((entry) => entry.id === id);
      if (!item || item.read_at) return current;
      return {
        notifications: current.notifications.map((entry) =>
          entry.id === id ? { ...entry, read_at: readAt } : entry,
        ),
        unreadCount: Math.max(0, current.unreadCount - 1),
      };
    });
    try {
      await markNotificationRead(id);
    } catch (error) {
      // Optimistic — a later fetch reconciles if the server rejected it.
      console.error('[notifications] mark read failed', error);
    }
  }, [applyMutation]);

  const markAllRead = useCallback(async () => {
    const now = new Date().toISOString();
    applyMutation((current) => {
      if (current.unreadCount <= 0) return current;
      return {
        notifications: current.notifications.map((entry) => ({
          ...entry,
          read_at: entry.read_at ?? now,
        })),
        unreadCount: 0,
      };
    });
    try {
      await markAllNotificationsRead();
    } catch (error) {
      console.error('[notifications] mark all read failed', error);
    }
  }, [applyMutation]);

  // What the badge shows: unread notifications newer than the last look at the
  // list. Before the member has ever opened it there is no watermark, and the
  // server's unread total stands in — the familiar all-time count.
  const unseenCount = useMemo(
    () =>
      userId && seenLoaded
        ? seenAt
          ? countUnseenSince(state.notifications, seenAt)
          : state.unreadCount
        : 0,
    [userId, seenLoaded, seenAt, state.notifications, state.unreadCount],
  );

  return {
    notifications: state.notifications,
    unreadCount: state.unreadCount,
    unseenCount,
    /** False until the persisted watermark has been read back. */
    seenLoaded,
    loading,
    refresh: fetchNotifications,
    markOneRead,
    markAllRead,
  };
}
