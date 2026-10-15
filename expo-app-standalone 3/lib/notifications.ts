/**
 * Notifications — the platform-free half: types, tab classification, the bell's
 * seen watermark store and the web-href → mobile-route mapping.
 *
 * Mirrors the web modules `apps/web/lib/notifications-tabs.ts` and
 * `apps/web/lib/notifications-seen.ts`; the rules (which type renders under
 * which tab, what the badge counts, where a row navigates) must stay identical
 * on both clients. Nothing here imports React Native or the API client, so the
 * whole module runs under `tsx --test` on CI (see notifications.test.ts) —
 * following the `realtimeCore.ts` split.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Mirrors NotificationType in apps/web/lib/notifications.ts. */
export type NotificationType =
  | "thread_comment"
  | "thread_reply"
  | "thread_like"
  | "resource_comment"
  | "resource_reply"
  | "event_comment"
  | "event_reply"
  | "event_rsvp"
  | "thread_deleted"
  | "showcase_deleted"
  | "resource_deleted"
  | "event_deleted"
  | "report_reviewed"
  | "content_restored"
  | "job_match"
  | "join_request_accepted";

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

/** The list keeps the same page size as the web (GET returns the newest 30). */
export const MAX_NOTIFICATION_ITEMS = 30;

// ---------------------------------------------------------------------------
// Tab classification (port of web lib/notifications-tabs.ts)
// ---------------------------------------------------------------------------

export type NotificationTab = "activity" | "events" | "jobs" | "other";

/** Tab order and labels — the screen supplies the icons. */
export const NOTIFICATION_TABS: ReadonlyArray<{
  key: NotificationTab;
  label: string;
}> = [
  { key: "activity", label: "Likes and comments" },
  { key: "events", label: "Events" },
  { key: "jobs", label: "Jobs" },
  { key: "other", label: "Other" },
];

const TAB_TYPES: Record<NotificationTab, ReadonlySet<NotificationType>> = {
  activity: new Set([
    "thread_like",
    "thread_comment",
    "thread_reply",
    "resource_comment",
    "resource_reply",
  ]),
  events: new Set(["event_comment", "event_reply", "event_rsvp"]),
  jobs: new Set(["job_match"]),
  other: new Set([
    "thread_deleted",
    "showcase_deleted",
    "resource_deleted",
    "event_deleted",
    "report_reviewed",
    "content_restored",
    "join_request_accepted",
  ]),
};

/** The tab a type renders under, or null while no tab claims it yet. */
export function notificationTabFor(type: NotificationType): NotificationTab | null {
  if (TAB_TYPES.activity.has(type)) return "activity";
  if (TAB_TYPES.events.has(type)) return "events";
  if (TAB_TYPES.jobs.has(type)) return "jobs";
  if (TAB_TYPES.other.has(type)) return "other";
  return null;
}

/**
 * Splits a newest-first notification page into its tabs, counting unread items
 * per tab along the way. Types no tab claims are dropped from every list (and
 * from the counts) — they stay invisible until a tab declares them.
 */
export function splitNotificationsByTab<
  T extends { type: NotificationType; read_at: string | null },
>(items: readonly T[]): {
  activity: T[];
  events: T[];
  jobs: T[];
  other: T[];
  unreadByTab: Record<NotificationTab, number>;
} {
  const activity: T[] = [];
  const events: T[] = [];
  const jobs: T[] = [];
  const other: T[] = [];
  const unreadByTab: Record<NotificationTab, number> = {
    activity: 0,
    events: 0,
    jobs: 0,
    other: 0,
  };

  for (const item of items) {
    const tab = notificationTabFor(item.type);
    if (!tab) continue;
    (tab === "activity" ? activity : tab === "events" ? events : tab === "jobs" ? jobs : other).push(
      item,
    );
    if (!item.read_at) unreadByTab[tab] += 1;
  }

  return { activity, events, jobs, other, unreadByTab };
}

// ---------------------------------------------------------------------------
// Seen watermark (port of web lib/notifications-seen.ts over a storage seam)
// ---------------------------------------------------------------------------

export interface SeenStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function seenStorageKey(userId: string): string {
  return `@notifications/seen/${userId}`;
}

/**
 * The bell's "seen" watermark — the timestamp of the newest notification the
 * member has looked at. Deliberately separate from read state: opening the list
 * advances the watermark (clearing the badge) without writing read_at, so the
 * unread dots and "Mark all read" stay until the member actually acts.
 *
 * The value is a notification's own `created_at` (not a client clock), so the
 * comparison never depends on the device clock. The in-memory map is the source
 * of truth once hydrated; AsyncStorage (supplied by `notificationsSeen.ts`) is
 * where it survives restarts.
 */
export function createSeenStore(storage: SeenStorage) {
  const watermarks = new Map<string, string | null>();
  const hydrated = new Set<string>();
  const listeners = new Set<() => void>();

  function notify() {
    listeners.forEach((listener) => listener());
  }

  return {
    /** The in-memory watermark (null before hydration or when never set). */
    read(userId: string): string | null {
      return watermarks.get(userId) ?? null;
    },

    /** Loads the persisted watermark once per user; safe to call repeatedly. */
    async hydrate(userId: string): Promise<string | null> {
      if (!hydrated.has(userId)) {
        hydrated.add(userId);
        try {
          watermarks.set(userId, await storage.getItem(seenStorageKey(userId)));
          notify();
        } catch {
          watermarks.set(userId, null);
        }
      }
      return watermarks.get(userId) ?? null;
    },

    /** Monotonic: the watermark never moves backwards, so a stale list can't undo it. */
    advance(userId: string, value: string): boolean {
      const current = watermarks.get(userId) ?? null;
      if (current !== null && Date.parse(current) >= Date.parse(value)) return false;
      watermarks.set(userId, value);
      void storage.setItem(seenStorageKey(userId), value).catch(() => {
        // Best effort — the in-memory watermark still covers this session.
      });
      notify();
      return true;
    },

    /** Drops the cached copy so the next hydrate hits storage again. */
    forget(userId: string) {
      watermarks.delete(userId);
      hydrated.delete(userId);
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function newestCreatedAt(
  notifications: ReadonlyArray<{ created_at: string }>,
): string | null {
  let newest: string | null = null;
  let newestMs = -Infinity;
  for (const item of notifications) {
    const ms = Date.parse(item.created_at);
    if (ms > newestMs) {
      newestMs = ms;
      newest = item.created_at;
    }
  }
  return newest;
}

/** Unread notifications created strictly after the watermark. */
export function countUnseenSince(
  notifications: ReadonlyArray<{ read_at: string | null; created_at: string }>,
  seenAt: string,
): number {
  const watermark = Date.parse(seenAt);
  return notifications.filter(
    (item) => item.read_at === null && Date.parse(item.created_at) > watermark,
  ).length;
}

// ---------------------------------------------------------------------------
// Deep-link mapping
// ---------------------------------------------------------------------------

/** Deep-link destinations — literal pathnames so expo-router's typed Href accepts them. */
export type NotificationRoute =
  | { pathname: '/community/[id]'; params: { id: string; tab?: string } }
  | { pathname: '/jobs/[id]'; params: { id: string } };

const COMMUNITY_CONTENT_RE =
  /^\/dashboard\/communities\/([^/]+)\/(threads|showcase|resources|events)\/([^/]+)\/?$/;
const COMMUNITY_RE = /^\/dashboard\/communities\/([^/]+)\/?$/;
const JOB_RE = /^\/dashboard\/jobs\/([^/]+)\/?$/;

/**
 * Maps the web `href` stored on a notification row to a mobile route.
 *
 * Removal notices link to the community itself (their content is gone), so
 * `/dashboard/communities/<id>` lands on the chat. Content links carry the tab
 * so the community screen opens on the surface the notification is about; the
 * community screen resolves the rest of its display data from the signed-in
 * member's list, exactly like a push deep-link does.
 *
 * Returns null for hrefs with no mobile destination — the row stays visible
 * but not tappable rather than navigating into a not-found.
 */
export function notificationRouteFor(href: unknown): NotificationRoute | null {
  if (typeof href !== "string") return null;

  let match = COMMUNITY_CONTENT_RE.exec(href);
  if (match) {
    return {
      pathname: "/community/[id]",
      params: { id: match[1], tab: match[2] },
    };
  }

  match = COMMUNITY_RE.exec(href);
  if (match) {
    return { pathname: "/community/[id]", params: { id: match[1] } };
  }

  match = JOB_RE.exec(href);
  if (match) {
    return { pathname: "/jobs/[id]", params: { id: match[1] } };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/** "now" / "5m" / "3h" / "2d" — same buckets as the web view. */
export function formatRelativeTime(value: string, now: number = Date.now()): string {
  const diff = now - new Date(value).getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "now";
  if (diff < hour) return `${Math.floor(diff / minute)}m`;
  if (diff < day) return `${Math.floor(diff / hour)}h`;
  return `${Math.floor(diff / day)}d`;
}
