/**
 * Preference shapes for the Settings page's Notifications and Email cards.
 *
 * The values are stored on `public.notification_preferences` and travel over
 * `/api/push/settings` (GET fills in the same defaults the page uses when the
 * row does not exist yet), so the camelCase keys here mirror that API's
 * `preferences` object exactly.
 */

export interface PushPreferences {
  chatPushEnabled: boolean;
  chatSound: "default" | "silent";
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}

export interface EmailPreferences {
  emailJobUpdates: boolean;
  emailCommunityActivity: boolean;
  emailProductNews: boolean;
}

/**
 * `time` columns come back as "22:00:00"; the UI edits "22:00". Identical to
 * the conversion the push settings route applies to its GET response, so the
 * server-rendered props and the API agree on the clock format.
 */
export function clockHHMM(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const match = /^(\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : fallback;
}
