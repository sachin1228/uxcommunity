/**
 * The notifications client — the impure half of ./notifications: the
 * AsyncStorage-bound seen watermark, the /api/notifications calls, and the one
 * shared page store the header bell and the list screen both observe.
 *
 * One store per member, the same job the web's request cache does in front of
 * useNotifications: the bell mounts on every tab and the list is a pushed
 * screen, so a mark-read has to move both at once and the first fetch has to
 * be shared rather than repeated per mount.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiFetch } from './api';
import { createSeenStore, type NotificationItem } from './notifications';

/** The shared seen watermark, persisted per member (see ./notifications). */
export const notificationSeen = createSeenStore({
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
});

/** What GET /api/notifications answers. */
interface NotificationsPayload {
  notifications?: NotificationItem[];
  /** Server truth: the rows with read_at null. */
  unread_count?: number;
}

/** One member's loaded page plus the server's unread total. */
export interface NotificationsSnapshot {
  userId: string | null;
  notifications: NotificationItem[];
  unreadCount: number;
  /** False until a fetch has landed for this member — gates the first spinner. */
  loaded: boolean;
}

const EMPTY: NotificationsSnapshot = {
  userId: null,
  notifications: [],
  unreadCount: 0,
  loaded: false,
};

/** The endpoint's page size; realtime prepends would trim to the same window. */
const MAX_ITEMS = 30;
/** Like the web's request cache: a page younger than this is served as-is. */
const STALE_MS = 30_000;

let snapshot = EMPTY;
let fetchedAt = 0;
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: Omit<NotificationsSnapshot, 'userId'> & { userId: string }) {
  snapshot = next;
  fetchedAt = Date.now();
  listeners.forEach((listener) => listener());
}

/** The member's snapshot — a fresh empty one until their first fetch lands. */
export function getNotificationsSnapshot(userId: string | null): NotificationsSnapshot {
  return snapshot.userId === userId ? snapshot : EMPTY;
}

export function subscribeNotifications(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Fetches the first page. Concurrent callers share one request; a page younger
 * than STALE_MS is reused unless `force` (pull to refresh). Throws on failure —
 * the caller owns the error state, and a failed fetch never blanks the list.
 */
export function refreshNotifications(userId: string, force = false): Promise<void> {
  if (inFlight) return inFlight;
  if (!force && snapshot.userId === userId && Date.now() - fetchedAt < STALE_MS) {
    return Promise.resolve();
  }

  inFlight = (async () => {
    try {
      const { data } = await apiFetch<NotificationsPayload>('/api/notifications');
      publish({
        userId,
        notifications: (data.notifications ?? []).slice(0, MAX_ITEMS),
        unreadCount: data.unread_count ?? 0,
        loaded: true,
      });
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Marks one read: the row's dot and the header count move on the tap, the
 * PATCH follows (the web's optimistic contract — a failure leaves the server
 * as the final word on the next fetch).
 */
export function markNotificationRead(userId: string, notificationId: string): void {
  const current = getNotificationsSnapshot(userId);
  const target = current.notifications.find((item) => item.id === notificationId);
  const wasUnread = Boolean(target && !target.read_at);

  if (target && wasUnread) {
    const readAt = new Date().toISOString();
    publish({
      userId,
      notifications: current.notifications.map((item) =>
        item.id === notificationId ? { ...item, read_at: readAt } : item,
      ),
      unreadCount: Math.max(0, current.unreadCount - 1),
      loaded: current.loaded,
    });
  }

  void apiFetch('/api/notifications', { method: 'PATCH', body: { id: notificationId } }).catch(
    () => {
      // The next fetch restores the truth.
    },
  );
}

/** Marks every unread row read, in the store and on the server. */
export function markAllNotificationsRead(userId: string): void {
  const current = getNotificationsSnapshot(userId);
  if (current.unreadCount <= 0) return;

  const readAt = new Date().toISOString();
  publish({
    userId,
    notifications: current.notifications.map((item) =>
      item.read_at ? item : { ...item, read_at: readAt },
    ),
    unreadCount: 0,
    loaded: current.loaded,
  });

  void apiFetch('/api/notifications', { method: 'PATCH', body: { all: true } }).catch(() => {
    // The next fetch restores the truth.
  });
}
