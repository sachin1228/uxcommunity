/**
 * Bounded cache for resolved sender names.
 *
 * WHY A BOUND
 *
 * Realtime chat rows carry only a `user_id`, so the community list resolves a
 * display name per sender from `/api/communities/:id/members/:uid` and remembers
 * it (`useCommunities`). That map lived in a `useRef` for the whole app
 * lifetime, so every distinct sender ever seen in any community stayed
 * resident — an unbounded, never-shrinking lookup table for an account that
 * visits many communities (production-readiness audit, low-priority memory
 * item).
 *
 * WHY LRU-ON-WRITE AND NOT A TTL
 *
 * A name is not time-sensitive: it only goes stale when the member renames
 * themselves, and the row that triggered the lookup is long gone by then. What
 * matters is that names the user keeps seeing survive while one-off senders are
 * recycled. Evicting the least recently WRITTEN entry does that using a plain
 * `Map`'s insertion order: re-resolving a sender — which happens whenever they
 * appear in a new row — moves them to the back, so the front of the map is
 * exactly the coldest name.
 */

/**
 * Hard cap on remembered names.
 *
 * Ids plus names are well under 100 KB at this size, which is far below the
 * point where a phone would care, while still covering the senders an active
 * member actually sees between reconnects.
 */
export const DEFAULT_NAME_CACHE_MAX_ENTRIES = 500;

export type NameCache = {
  /** True when a name for `uid` is already remembered. */
  has(uid: string): boolean;
  /** The remembered name, or `undefined` when it was never resolved. */
  get(uid: string): string | undefined;
  /** Remember `name` for `uid`, evicting the coldest entry once full. */
  set(uid: string, name: string): void;
  /** Number of remembered names — never greater than the cap. */
  size(): number;
  /** Drop every remembered name. */
  clear(): void;
};

/**
 * Create a name cache that never exceeds `maxEntries` live entries.
 *
 * The cap is enforced on write, so `size()` is bounded at all times rather than
 * only shrinking during a sweep.
 */
export function createNameCache(
  maxEntries: number = DEFAULT_NAME_CACHE_MAX_ENTRIES,
): NameCache {
  // A cap below 1 would evict every write immediately and defeat the cache, so
  // clamp instead of trusting the caller.
  const limit = Math.max(1, Math.floor(maxEntries));
  const entries = new Map<string, string>();

  return {
    has: (uid) => entries.has(uid),
    get: (uid) => entries.get(uid),

    set(uid, name) {
      // Delete before set so the write lands at the back of the map: insertion
      // order is our recency order, and a re-resolved sender must not stay near
      // the front where the next eviction would drop them.
      entries.delete(uid);
      entries.set(uid, name);
      while (entries.size > limit) {
        const oldest = entries.keys().next();
        if (oldest.done) break;
        entries.delete(oldest.value);
      }
    },

    size: () => entries.size,
    clear: () => entries.clear(),
  };
}
