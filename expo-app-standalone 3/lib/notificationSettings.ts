/**
 * Notification settings API.
 *
 * One round trip carries everything the settings screen and the badge need:
 * the member's preferences, which communities they muted, and the total unread
 * count. The server owns the defaults, so a member who has never opened the
 * screen still gets a complete object back rather than a partial one the app
 * would have to fill in itself.
 */

import { apiFetch } from './api';
import { setAppBadgeCountAsync, setMutedCommunities } from './push';

export interface NotificationPreferences {
  chatPushEnabled: boolean;
  chatSound: 'default' | 'silent';
  quietHoursEnabled: boolean;
  /** "HH:MM" */
  quietHoursStart: string;
  /** "HH:MM" */
  quietHoursEnd: string;
  /** IANA name, reported by the device when saving. */
  quietHoursTimezone: string;
}

export interface NotificationSettings {
  preferences: NotificationPreferences;
  mutedCommunityIds: string[];
  unreadCount: number;
}

/** What the app assumes before the first load completes. Mirrors the server. */
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  chatPushEnabled: true,
  chatSound: 'default',
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  quietHoursTimezone: 'UTC',
};

/** The device's own timezone, so quiet hours fire at the member's night. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export async function fetchNotificationSettings(): Promise<NotificationSettings> {
  const { data } = await apiFetch<NotificationSettings>('/api/push/settings');

  const settings: NotificationSettings = {
    preferences: { ...DEFAULT_PREFERENCES, ...(data?.preferences ?? {}) },
    mutedCommunityIds: data?.mutedCommunityIds ?? [],
    unreadCount: data?.unreadCount ?? 0,
  };

  // Keep the foreground handler's view of muted communities in step — it runs
  // outside React and cannot fetch.
  await setMutedCommunities(settings.mutedCommunityIds);

  return settings;
}

/** Partial save: the server touches only the keys present. */
export async function saveNotificationPreferences(
  patch: Partial<NotificationPreferences>,
): Promise<void> {
  await apiFetch('/api/push/settings', { method: 'PATCH', body: patch });
}

export async function saveMutedCommunityIds(ids: string[]): Promise<void> {
  await apiFetch('/api/push/settings', { method: 'PATCH', body: { mutedCommunityIds: ids } });
  await setMutedCommunities(ids);
}

/**
 * Corrects the app icon badge from the server's total. Called after reading a
 * community, because the server is the only side that knows how the other
 * communities add up once this one has been marked read.
 */
export async function syncBadgeFromServer(): Promise<void> {
  try {
    const settings = await fetchNotificationSettings();
    await setAppBadgeCountAsync(settings.unreadCount);
  } catch {
    /* the badge simply keeps its previous value */
  }
}
