// Tab classification for the notifications page. Kept out of the view so the
// rules are unit-testable (and so a new notification type has exactly one place
// to declare itself).

import type { NotificationType } from "./use-notifications";

export type NotificationTab = "activity" | "events" | "other";

/** Tab order and labels — the view supplies the icons. */
export const NOTIFICATION_TABS: ReadonlyArray<{
  key: NotificationTab;
  label: string;
}> = [
  { key: "activity", label: "Likes and comments" },
  { key: "events", label: "Events" },
  { key: "other", label: "Other" },
];

/** Types that concern events — everything here renders under the Events tab. */
const EVENT_TYPES: ReadonlySet<NotificationType> = new Set([
  "event_comment",
  "event_reply",
  "event_rsvp",
]);

/**
 * Which types each tab renders.
 *
 * - `activity` — engagement on the user's own content: a like or a
 *   comment/reply anywhere in the thread under what they posted.
 * - `events` — everything about the user's events: RSVPs plus the
 *   comments/replies posted on them.
 * - `other` — removals and report outcomes: a community owner/admin/moderator
 *   or the platform removed the user's content (the routes that log
 *   thread_deleted & co. also send the author a notification), plus the
 *   thank-you a reporter gets once their report was actioned. Add any further
 *   types here; update the tab's empty-state copy in NotificationsView to
 *   match.
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
  ]),
  events: EVENT_TYPES,
  other: new Set([
    "thread_deleted",
    "showcase_deleted",
    "resource_deleted",
    "event_deleted",
    "report_reviewed",
    "content_restored",
  ]),
};

/** The tab a type renders under, or null while no tab claims it yet. */
export function notificationTabFor(type: NotificationType): NotificationTab | null {
  if (TAB_TYPES.activity.has(type)) return "activity";
  if (TAB_TYPES.events.has(type)) return "events";
  if (TAB_TYPES.other.has(type)) return "other";
  return null;
}

/**
 * Splits a newest-first notification page into its tabs, counting unread
 * items per tab along the way. Order inside each tab is preserved, so the
 * realtime path's prepends keep all lists sorted.
 *
 * Types no tab claims are dropped from every list (and from the counts) — they
 * stay invisible until a tab declares them.
 */
export function splitNotificationsByTab<
  T extends { type: NotificationType; read_at: string | null },
>(items: readonly T[]): {
  activity: T[];
  events: T[];
  other: T[];
  unreadByTab: Record<NotificationTab, number>;
} {
  const activity: T[] = [];
  const events: T[] = [];
  const other: T[] = [];
  const unreadByTab: Record<NotificationTab, number> = {
    activity: 0,
    events: 0,
    other: 0,
  };

  for (const item of items) {
    const tab = notificationTabFor(item.type);
    if (!tab) continue;
    (tab === "activity" ? activity : tab === "events" ? events : other).push(item);
    if (!item.read_at) unreadByTab[tab] += 1;
  }

  return { activity, events, other, unreadByTab };
}
