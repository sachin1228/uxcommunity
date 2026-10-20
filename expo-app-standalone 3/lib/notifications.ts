/**
 * The notifications model — the mobile reading of the web page at
 * /dashboard/notifications.
 *
 * Ported whole from the web's lib/notifications-tabs.ts and
 * lib/notifications-seen.ts: which notification types exist, which tab each
 * one renders under, the bell's seen watermark, and how a notification's web
 * href becomes a route this app can open.
 *
 * Storage-free on purpose, like ./tabSeen: the AsyncStorage-bound watermark
 * and the /api/notifications calls live in ./notificationsClient, so the rules
 * here stay unit-testable.
 */

import type { ContentKind } from './communityContent';

// Mirrors NotificationType in the web app's lib/use-notifications.ts — the
// types still generated. Community broadcasts and chat @mentions were removed
// there, so they are not here either.
export type NotificationType =
  | 'thread_comment'
  | 'thread_reply'
  | 'thread_like'
  | 'resource_comment'
  | 'resource_reply'
  | 'event_comment'
  | 'event_reply'
  | 'event_rsvp'
  | 'thread_deleted'
  | 'showcase_deleted'
  | 'resource_deleted'
  | 'event_deleted'
  | 'report_reviewed'
  | 'content_restored'
  | 'job_match'
  | 'join_request_accepted'
  | 'event_reminder'
  | 'event_live'
  | 'event_ended';

/** One row of GET /api/notifications, trimmed to what the list draws. */
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

export type NotificationTab = 'likes' | 'comments' | 'events' | 'jobs' | 'other';

/** Tab order and labels — the screen supplies the icons (web parity). */
export const NOTIFICATION_TABS: ReadonlyArray<{
  key: NotificationTab;
  label: string;
}> = [
  { key: 'likes', label: 'Likes' },
  { key: 'comments', label: 'Comments' },
  { key: 'events', label: 'Events' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'other', label: 'Other' },
];

/**
 * Which types each tab renders (the web's TAB_TYPES, minus community
 * broadcasts their app no longer generates).
 *
 * Nothing renders until a tab claims its type, so an unlisted type stays
 * invisible rather than leaking into a tab that did not ask for it.
 */
const TAB_TYPES: Record<NotificationTab, ReadonlySet<NotificationType>> = {
  likes: new Set(['thread_like']),
  comments: new Set([
    'thread_comment',
    'thread_reply',
    'resource_comment',
    'resource_reply',
  ]),
  events: new Set([
    'event_comment',
    'event_reply',
    'event_rsvp',
    'event_reminder',
    'event_live',
    'event_ended',
  ]),
  jobs: new Set(['job_match']),
  other: new Set([
    'thread_deleted',
    'showcase_deleted',
    'resource_deleted',
    'event_deleted',
    'report_reviewed',
    'content_restored',
    'join_request_accepted',
  ]),
};

/** The tab a type renders under, or null while no tab claims it yet. */
export function notificationTabFor(type: NotificationType): NotificationTab | null {
  if (TAB_TYPES.likes.has(type)) return 'likes';
  if (TAB_TYPES.comments.has(type)) return 'comments';
  if (TAB_TYPES.events.has(type)) return 'events';
  if (TAB_TYPES.jobs.has(type)) return 'jobs';
  if (TAB_TYPES.other.has(type)) return 'other';
  return null;
}

/**
 * Splits a newest-first notification page into its tabs, counting unread items
 * per tab along the way. Order inside each tab is preserved; types no tab
 * claims are dropped from every list (and from the counts).
 */
export function splitNotificationsByTab<
  T extends { type: NotificationType; read_at: string | null },
>(items: readonly T[]): {
  likes: T[];
  comments: T[];
  events: T[];
  jobs: T[];
  other: T[];
  unreadByTab: Record<NotificationTab, number>;
} {
  const likes: T[] = [];
  const comments: T[] = [];
  const events: T[] = [];
  const jobs: T[] = [];
  const other: T[] = [];
  const unreadByTab: Record<NotificationTab, number> = {
    likes: 0,
    comments: 0,
    events: 0,
    jobs: 0,
    other: 0,
  };

  for (const item of items) {
    const tab = notificationTabFor(item.type);
    if (!tab) continue;
    const bucket =
      tab === 'likes'
        ? likes
        : tab === 'comments'
          ? comments
          : tab === 'events'
            ? events
            : tab === 'jobs'
              ? jobs
              : other;
    bucket.push(item);
    if (!item.read_at) unreadByTab[tab] += 1;
  }

  return { likes, comments, events, jobs, other, unreadByTab };
}

// ---------------------------------------------------------------------------
// The bell's seen watermark
// ---------------------------------------------------------------------------

/**
 * The bell badge counts "new since you last looked": opening the list
 * advances a watermark (clearing the number) without writing read_at, so the
 * unread dots and "Mark all read" stay exactly as they were, and the next
 * notification counts again from one. The value is a notification's own
 * created_at — never the device clock.
 */

/** Storage key — one watermark per member (mobile's `@` convention). */
export function notificationSeenStorageKey(userId: string): string {
  return `@notifications/seen/${userId}`;
}

export interface SeenStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/**
 * The watermark store. `read` answers undefined until the key has been
 * hydrated — the caller must never anchor or compare before that, or first-run
 * reads would treat a persisted watermark as missing.
 */
export function createSeenStore(storage: SeenStorage) {
  const watermarks = new Map<string, string | null>();
  const hydrated = new Set<string>();
  const listeners = new Set<() => void>();

  function notify() {
    listeners.forEach((listener) => listener());
  }

  return {
    /** The watermark: undefined before hydration, null when never opened. */
    read(userId: string): string | null | undefined {
      return hydrated.has(userId) ? watermarks.get(userId) ?? null : undefined;
    },

    /** Loads the persisted watermark once per member; safe to repeat. */
    async hydrate(userId: string): Promise<string | null> {
      if (!hydrated.has(userId)) {
        hydrated.add(userId);
        try {
          // A watermark advanced before hydration (the list loaded first) is
          // newer than storage by definition — never let a late read undo it.
          if (!watermarks.has(userId)) {
            watermarks.set(userId, await storage.getItem(notificationSeenStorageKey(userId)));
          }
        } catch {
          // Storage can fail; the in-memory value still covers this session.
          if (!watermarks.has(userId)) watermarks.set(userId, null);
        }
        notify();
      }
      return watermarks.get(userId) ?? null;
    },

    /** Monotonic, persisted: returns whether anything changed. */
    advance(userId: string, value: string): boolean {
      const current = watermarks.get(userId) ?? null;
      if (current !== null && Date.parse(current) >= Date.parse(value)) return false;
      watermarks.set(userId, value);
      void storage.setItem(notificationSeenStorageKey(userId), value).catch(() => {
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

/** The newest created_at in a page (null when it is empty). */
export function newestCreatedAt(notifications: Array<{ created_at: string }>): string | null {
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
  notifications: Array<{ read_at: string | null; created_at: string }>,
  seenAt: string,
): number {
  const watermark = Date.parse(seenAt);
  return notifications.filter(
    (item) => item.read_at === null && Date.parse(item.created_at) > watermark,
  ).length;
}

// ---------------------------------------------------------------------------
// Where a notification opens
// ---------------------------------------------------------------------------

/**
 * A notification's href is a web dashboard path. Three shapes exist
 * (lib/notifications.ts on the web builds them all): a community, one item
 * inside a community, and a job posting. Everything else — the
 * /dashboard/notifications fallback a report outcome uses when its community
 * is gone — maps to nothing, and the row just marks itself read.
 */
export type NotificationRoute =
  | {
      kind: 'community';
      communityId: string;
      /** Present when the href named one item; the community alone otherwise. */
      contentKind?: ContentKind;
      contentId?: string;
    }
  /** A city event with no community of its own — the Events tab lists it. */
  | { kind: 'events' }
  | { kind: 'jobs' }
  | { kind: 'none' };

/** The content kinds, as they appear in a URL (the app's tab keys). */
const CONTENT_KINDS: readonly ContentKind[] = ['threads', 'showcase', 'resources', 'events'];

function isContentKindSegment(value: string): value is ContentKind {
  return (CONTENT_KINDS as readonly string[]).includes(value);
}

export function notificationHrefToRoute(href: string): NotificationRoute {
  // Tolerate absolute URLs, queries and hashes: the segments after
  // "dashboard" are what matter.
  const segments = href.split(/[?#]/)[0].split('/').filter(Boolean);
  const start = segments.indexOf('dashboard');
  if (start === -1) return { kind: 'none' };

  const section = segments[start + 1];
  const id = segments[start + 2];

  if (section === 'communities' && id) {
    const kind = segments[start + 3];
    const contentId = segments[start + 4];
    if (kind && contentId && isContentKindSegment(kind)) {
      return { kind: 'community', communityId: id, contentKind: kind, contentId };
    }
    return { kind: 'community', communityId: id };
  }

  if (section === 'events' && id) return { kind: 'events' };

  if (section === 'jobs' && id) return { kind: 'jobs' };

  return { kind: 'none' };
}
