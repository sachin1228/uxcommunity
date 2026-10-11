"use client";

/**
 * The bell's "seen" watermark — the timestamp of the newest notification the
 * member has looked at. It is deliberately separate from read state: opening
 * /dashboard/notifications advances the watermark (clearing the badge number)
 * without writing read_at, so the list keeps its unread dots and "Mark all
 * read" until the member actually acts. Notifications created after the
 * watermark count again from one.
 *
 * The value is a notification's own `created_at` (not a client clock), so the
 * comparison never depends on the device's clock being right. It is persisted
 * per user in localStorage and mirrored in a module-level map so every hook in
 * the tab — the topbar badge and the page — sees an advance instantly; the
 * `storage` event covers other tabs.
 */

const STORAGE_PREFIX = "uxcommunity:notifications:seen:";

export function seenStorageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

const watermarks = new Map<string, string | null>();
const listeners = new Set<() => void>();

export function readSeenAt(userId: string): string | null {
  if (watermarks.has(userId)) return watermarks.get(userId) ?? null;
  let stored: string | null = null;
  if (typeof window !== "undefined") {
    try {
      stored = window.localStorage.getItem(seenStorageKey(userId));
    } catch {
      // Storage can be denied (private mode); the map still covers this session.
    }
  }
  watermarks.set(userId, stored);
  return stored;
}

/** Monotonic: the watermark never moves backwards, so a stale list can't undo it. */
export function advanceSeenAt(userId: string, value: string): boolean {
  const current = readSeenAt(userId);
  if (current !== null && Date.parse(current) >= Date.parse(value)) return false;
  watermarks.set(userId, value);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(seenStorageKey(userId), value);
    } catch {
      // Best effort — the in-memory watermark still covers this tab.
    }
  }
  listeners.forEach((listener) => listener());
  return true;
}

/** Drops the cached copy so the next read hits localStorage again (other tabs). */
export function forgetSeenAt(userId: string) {
  watermarks.delete(userId);
}

export function subscribeSeenAt(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function newestCreatedAt(
  notifications: Array<{ created_at: string }>,
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
  notifications: Array<{ read_at: string | null; created_at: string }>,
  seenAt: string,
): number {
  const watermark = Date.parse(seenAt);
  return notifications.filter(
    (item) => item.read_at === null && Date.parse(item.created_at) > watermark,
  ).length;
}
