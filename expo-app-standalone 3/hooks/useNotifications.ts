/**
 * The notifications list and its bell badge, sharing one store (see
 * lib/notificationsClient).
 *
 * Two counts come out of it, exactly like the web hook it mirrors:
 * `unreadCount` (server truth — the rows with read_at null) and `unseenCount`
 * (what the bell shows — the unread rows created after the member last opened
 * the list).
 *
 * `autoMarkSeen` is what the list screen passes: being looked at clears the
 * bell's number without marking anything read, so the unread dots, the per-tab
 * counts and "Mark all read" stay exactly as they were.
 */

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { countUnseenSince, newestCreatedAt } from '@/lib/notifications';
import {
  getNotificationsSnapshot,
  markAllNotificationsRead,
  markNotificationRead,
  notificationSeen,
  refreshNotifications,
  subscribeNotifications,
} from '@/lib/notificationsClient';

export function useNotifications(
  userId: string | null | undefined,
  options: { autoMarkSeen?: boolean } = {},
) {
  const id = userId ?? null;
  const { autoMarkSeen = false } = options;

  const snapshot = useSyncExternalStore(subscribeNotifications, () =>
    getNotificationsSnapshot(id),
  );
  const [seenAt, setSeenAt] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(!snapshot.loaded);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (force = false) => {
      if (!id) return;
      try {
        await refreshNotifications(id, force);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load notifications.');
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    setLoading(!getNotificationsSnapshot(id).loaded);
    void load();
  }, [id, load]);

  // The watermark lives in async storage, so mirror it into state: whatever
  // advances it — this screen, the badge, or a later hydrate — re-renders.
  useEffect(() => {
    if (!id) return;
    const reRead = () => setSeenAt(notificationSeen.read(id));
    const unsubscribe = notificationSeen.subscribe(reRead);
    reRead();
    void notificationSeen.hydrate(id).then(reRead);
    return unsubscribe;
  }, [id]);

  // Notifications arrive while the app is away: catch up when it comes back,
  // or the bell would keep a count from before the phone was pocketed.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load(true);
    });
    return () => subscription.remove();
  }, [load]);

  // On the list screen, each change to the loaded page advances the watermark
  // past everything in it, so the badge reads zero while it is open and starts
  // from one again for anything arriving after the member leaves.
  useEffect(() => {
    if (!autoMarkSeen || !id) return;
    const newest = newestCreatedAt(snapshot.notifications);
    if (newest !== null) notificationSeen.advance(id, newest);
  }, [autoMarkSeen, id, snapshot.notifications]);

  // Before the member has ever opened the list there is no watermark, and the
  // server's unread total stands in — the familiar all-time count. While
  // storage is still being read the answer is unknown, and the bell badge
  // stays hidden rather than flashing a number it may have to take back.
  const unseenCount = useMemo(() => {
    if (seenAt === undefined) return null;
    if (seenAt === null) return snapshot.unreadCount;
    return countUnseenSince(snapshot.notifications, seenAt);
  }, [seenAt, snapshot]);

  const markRead = useCallback(
    (notificationId: string) => {
      if (id) markNotificationRead(id, notificationId);
    },
    [id],
  );

  const markAllRead = useCallback(() => {
    if (id) markAllNotificationsRead(id);
  }, [id]);

  const refresh = useCallback(() => load(true), [load]);

  return {
    notifications: snapshot.notifications,
    unreadCount: snapshot.unreadCount,
    /** What the bell shows — null until the watermark has been read. */
    unseenCount,
    loading,
    error,
    refresh,
    markRead,
    markAllRead,
  };
}
