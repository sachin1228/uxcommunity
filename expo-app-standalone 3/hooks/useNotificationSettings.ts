/**
 * Loads and saves the member's notification preferences.
 *
 * Every toggle writes optimistically and rolls back on failure, because a
 * switch that waits for a round trip before moving reads as broken.
 *
 * Per-community mutes do not live here: they belong to each community's chat
 * header (the bell), which writes `notifications_muted` on the membership —
 * the same field the server's push fan-out gates on.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_PREFERENCES,
  NotificationPreferences,
  deviceTimeZone,
  fetchNotificationSettings,
  saveNotificationPreferences,
} from '@/lib/notificationSettings';
import { setAppBadgeCountAsync } from '@/lib/push';

export function useNotificationSettings() {
  const [preferences, setPreferences] = useState<NotificationPreferences>(DEFAULT_PREFERENCES);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const settings = await fetchNotificationSettings();
      if (!mountedRef.current) return;
      setPreferences(settings.preferences);
      setUnreadCount(settings.unreadCount);
      setError(null);
    } catch (e) {
      if (!mountedRef.current) return;
      setError(e instanceof Error ? e.message : 'Could not load notification settings.');
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updatePreferences = useCallback(
    async (patch: Partial<NotificationPreferences>) => {
      const previous = preferences;
      setPreferences((current) => ({ ...current, ...patch }));
      setSaving(true);
      try {
        await saveNotificationPreferences(patch);
        setError(null);
      } catch (e) {
        if (mountedRef.current) {
          setPreferences(previous);
          setError(e instanceof Error ? e.message : 'Could not save that change.');
        }
      } finally {
        if (mountedRef.current) setSaving(false);
      }
    },
    [preferences],
  );

  /** Quiet hours are the member's local night, so the zone rides along. */
  const updateQuietHours = useCallback(
    async (patch: Partial<NotificationPreferences>) =>
      updatePreferences({ ...patch, quietHoursTimezone: deviceTimeZone() }),
    [updatePreferences],
  );

  /** Pushes the server's unread total onto the app icon. */
  const syncBadge = useCallback(async () => {
    await setAppBadgeCountAsync(unreadCount);
  }, [unreadCount]);

  return {
    preferences,
    unreadCount,
    isLoading,
    saving,
    error,
    reload: load,
    updatePreferences,
    updateQuietHours,
    syncBadge,
  };
}
