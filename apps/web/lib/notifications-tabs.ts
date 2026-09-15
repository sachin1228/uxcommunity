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
 * Which types each tab renders.
 *
 * - `activity` — engagement on the user's own content: a like, an RSVP, or a
 *   comment/reply anywhere in the thread under what they posted.
 * - `other` — intentionally EMPTY. The tab is a visible placeholder; add the
 *   types that belong in it here (and update the tab's empty-state copy in
 *   NotificationsView) to populate it.
 *
 * Nothing renders until a tab claims its type, so an unlisted type stays
 * invisible rather than leaking into a tab that did not ask for it.
 */
const TAB_TYPES: Record<NotificationTab, ReadonlySet<NotificationType>> = {
  activity: new Set([
    "thread_like",
    "thread_comment",
    "thread_reply",
    "resource_comment",
    "resource_reply",
    "event_comment",
    "event_reply",
    "event_rsvp",
  ]),
  other: new Set(),
};

/** The tab a type renders under, or null while no tab claims it yet. */
export function notificationTabFor(type: NotificationType): NotificationTab | null {
  if (TAB_TYPES.activity.has(type)) return "activity";
  if (TAB_TYPES.other.has(type)) return "other";
  return null;
}

/**
 * Splits a newest-first notification page into its two tabs, counting unread
 * items per tab along the way. Order inside each tab is preserved, so the
 * realtime path's prepends keep both lists sorted.
 *
 * Types no tab claims are dropped from both lists (and from the counts) — they
 * stay invisible until a tab declares them.
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
    if (!tab) continue;
    (tab === "activity" ? activity : other).push(item);
    if (!item.read_at) unreadByTab[tab] += 1;
  }

  return { activity, other, unreadByTab };
}
