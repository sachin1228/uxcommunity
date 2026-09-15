// Tab classification for the notifications page. Kept out of the view so the
// rules are unit-testable (and so a new notification type has exactly one place
// to declare itself).

import type { NotificationType } from "./use-notifications";

export type NotificationTab = "activity" | "other";

/** Tab order and labels — the view supplies the icons. */
export const NOTIFICATION_TABS: ReadonlyArray<{
  key: NotificationTab;
  label: string;
}> = [
  { key: "activity", label: "Likes and comments" },
  { key: "other", label: "Other" },
];

/**
 * Engagement on the user's own content: a like, or a comment/reply anywhere in
 * the thread under what they posted.
 *
 * Everything else — the broadcast the app fans out when someone starts a new
 * thread, shares a resource or creates an event, plus RSVPs, saves and
 * @mentions — belongs in "Other", so the first tab stays the conversations the
 * user is actually part of. Unknown types default to "Other" too: a new type
 * added later must never start crowding the primary list.
 */
const ACTIVITY_TYPES: ReadonlySet<NotificationType> = new Set([
  "thread_like",
  "thread_comment",
  "thread_reply",
  "resource_comment",
  "resource_reply",
  "event_comment",
  "event_reply",
]);

export function notificationTabFor(type: NotificationType): NotificationTab {
  return ACTIVITY_TYPES.has(type) ? "activity" : "other";
}

/**
 * Splits a newest-first notification page into its two tabs, counting unread
 * items per tab along the way. Order inside each tab is preserved, so the
 * realtime path's prepends keep both lists sorted.
 */
export function splitNotificationsByTab<
  T extends { type: NotificationType; read_at: string | null },
>(items: readonly T[]): {
  activity: T[];
  other: T[];
  unreadByTab: Record<NotificationTab, number>;
} {
  const activity: T[] = [];
  const other: T[] = [];
  const unreadByTab: Record<NotificationTab, number> = { activity: 0, other: 0 };

  for (const item of items) {
    const tab = notificationTabFor(item.type);
    (tab === "activity" ? activity : other).push(item);
    if (!item.read_at) unreadByTab[tab] += 1;
  }

  return { activity, other, unreadByTab };
}
