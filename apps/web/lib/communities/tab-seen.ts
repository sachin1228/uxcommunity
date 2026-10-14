"use client";

/**
 * The community nav's per-tab "new since you last looked" watermarks.
 *
 * One watermark per (user, community, tab): the created_at of the newest item
 * the member has seen on that tab. Threads / Showcase / Resources / Events
 * compare their newest content item; Activity compares the newest
 * management-audit row. A tab carries a red dot while its newest item is
 * newer than this value; opening the tab advances the watermark, and the next
 * item created afterwards raises the dot again.
 *
 * Like the bell's seen watermark (lib/notifications-seen.ts) the values are
 * the items' own server timestamps, never the device clock, and they persist
 * per user in localStorage with an in-memory mirror for the live session.
 * The empty string is a deliberate baseline marker: a tab whose kind had no
 * items at all when it was first tracked is seeded with "" so the FIRST item
 * created later still compares as newer.
 */

const STORAGE_PREFIX = "uxcommunity:community-tabs:seen:";

export type CommunityTabSeenKey = "threads" | "showcase" | "resources" | "events" | "activity";

export type TabSeenMap = Partial<Record<CommunityTabSeenKey, string>>;

export function tabSeenStorageKey(userId: string, communityId: string) {
  return `${STORAGE_PREFIX}${userId}:${communityId}`;
}

const watermarks = new Map<string, TabSeenMap>();
const listeners = new Set<() => void>();

/** Subscribe for changes from any advance in this tab (useSyncExternalStore). */
export function subscribeTabSeen(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readTabSeen(userId: string, communityId: string): TabSeenMap {
  const key = tabSeenStorageKey(userId, communityId);
  const cached = watermarks.get(key);
  if (cached) return cached;
  let stored: TabSeenMap = {};
  if (typeof window !== "undefined") {
    try {
      const raw = window.localStorage.getItem(key);
      const parsed = raw ? (JSON.parse(raw) as unknown) : null;
      if (parsed && typeof parsed === "object") stored = parsed as TabSeenMap;
    } catch {
      // Storage can be denied (private mode); the map still covers this session.
    }
  }
  watermarks.set(key, stored);
  return stored;
}

/**
 * Advance one tab's watermark. Returns whether anything changed.
 * Monotonic per tab: a stale value never moves it backwards. A baseline
 * marker only fills an unset tab and is never written over a real timestamp
 * (and never overwrites another marker).
 */
export function advanceTabSeen(
  userId: string,
  communityId: string,
  tab: CommunityTabSeenKey,
  value: string,
): boolean {
  const map = readTabSeen(userId, communityId);
  const current = map[tab];
  if (current !== undefined) {
    if (value === "") return false;
    if (current !== "" && Date.parse(current) >= Date.parse(value)) return false;
  }
  const next: TabSeenMap = { ...map, [tab]: value };
  const key = tabSeenStorageKey(userId, communityId);
  watermarks.set(key, next);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // Best effort — the in-memory map still covers this tab.
    }
  }
  listeners.forEach((listener) => listener());
  return true;
}

/**
 * Whether a tab's newest item is itself newer than the watermark, i.e. the
 * tab should wear a dot. An undefined watermark means the tab was never
 * tracked — no dot, the baseline has not been anchored yet.
 */
export function isNewerThan(latest: string | null, seen: string | undefined): boolean {
  if (!latest || seen === undefined) return false;
  if (seen === "") return true;
  return Date.parse(latest) > Date.parse(seen);
}

/** The newer of two timestamps by parsed time (either may be null). */
export function newestIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}
