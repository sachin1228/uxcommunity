/**
 * The community nav's per-tab "new since you last looked" watermarks — a
 * port of the web app's `lib/communities/tab-seen.ts`.
 *
 * One watermark per (user, community, tab): the created_at of the newest item
 * the member has seen on that tab. Threads / Showcase / Resources / Events
 * compare their newest content item. A tab carries a red dot while its newest
 * item is newer than this value; opening the tab advances the watermark, and
 * the next item created afterwards raises the dot again.
 *
 * Like the bell's seen watermark (lib/notifications.ts's createSeenStore) the
 * values are the items' own server timestamps, never the device clock, and
 * the in-memory map is the source of truth once hydrated; AsyncStorage
 * (supplied by `communityTabSeen.ts`) is where it survives restarts.
 *
 * The empty string is a deliberate baseline marker: a tab whose kind had no
 * items at all when it was first tracked is seeded with "" so the FIRST item
 * created later still compares as newer.
 */

export type TabSeenKey = 'threads' | 'showcase' | 'resources' | 'events';

export type TabSeenMap = Partial<Record<TabSeenKey, string>>;

export interface TabSeenStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Storage key — one map per member per community (mobile's `@` convention). */
export function tabSeenStorageKey(userId: string, communityId: string): string {
  return `@community-tabs/seen/${userId}/${communityId}`;
}

/**
 * Whether a tab's newest item is itself newer than the watermark, i.e. the
 * tab should wear a dot. An undefined watermark means the tab was never
 * tracked — no dot, the baseline has not been anchored yet.
 */
export function isNewerThan(latest: string | null, seen: string | undefined): boolean {
  if (!latest || seen === undefined) return false;
  if (seen === '') return true;
  return Date.parse(latest) > Date.parse(seen);
}

/** The newer of two timestamps by parsed time (either may be null). */
export function newestIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/**
 * Advance one tab's watermark, purely. Returns the next map, or null when
 * nothing changed. Monotonic per tab: a stale value never moves it backwards.
 * A baseline marker ('') only fills an unset tab and is never written over a
 * real timestamp (and never overwrites another marker).
 */
export function advanceTabSeen(map: TabSeenMap, tab: TabSeenKey, value: string): TabSeenMap | null {
  const current = map[tab];
  if (current !== undefined) {
    if (value === '') return null;
    if (current !== '' && Date.parse(current) >= Date.parse(value)) return null;
  }
  return { ...map, [tab]: value };
}

/**
 * The watermark store. `read` answers null until the key has been hydrated —
 * the caller must never anchor or compare before that, or first-run reads
 * would treat persisted watermarks as missing.
 */
export function createTabSeenStore(storage: TabSeenStorage) {
  const maps = new Map<string, TabSeenMap>();
  const hydrated = new Set<string>();
  const listeners = new Set<() => void>();

  function notify() {
    listeners.forEach((listener) => listener());
  }

  return {
    /** The in-memory map (null before hydration). */
    read(userId: string, communityId: string): TabSeenMap | null {
      const key = tabSeenStorageKey(userId, communityId);
      return hydrated.has(key) ? maps.get(key) ?? {} : null;
    },

    /** Loads the persisted map once per (user, community); safe to repeat. */
    async hydrate(userId: string, communityId: string): Promise<TabSeenMap> {
      const key = tabSeenStorageKey(userId, communityId);
      if (!hydrated.has(key)) {
        hydrated.add(key);
        try {
          const raw = await storage.getItem(key);
          const parsed = raw ? (JSON.parse(raw) as unknown) : null;
          maps.set(key, parsed && typeof parsed === 'object' ? (parsed as TabSeenMap) : {});
        } catch {
          // Storage can fail; the empty map still covers this session.
          maps.set(key, {});
        }
        notify();
      }
      return maps.get(key) ?? {};
    },

    /** Monotonic, persisted: returns whether anything changed. */
    advance(userId: string, communityId: string, tab: TabSeenKey, value: string): boolean {
      const key = tabSeenStorageKey(userId, communityId);
      const next = advanceTabSeen(maps.get(key) ?? {}, tab, value);
      if (!next) return false;
      maps.set(key, next);
      void storage.setItem(key, JSON.stringify(next)).catch(() => {
        // Best effort — the in-memory map still covers this session.
      });
      notify();
      return true;
    },

    /** Drops the cached copy so the next hydrate hits storage again. */
    forget(userId: string, communityId: string) {
      const key = tabSeenStorageKey(userId, communityId);
      maps.delete(key);
      hydrated.delete(key);
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
