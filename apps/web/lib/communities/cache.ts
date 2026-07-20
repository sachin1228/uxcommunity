/**
 * Module-level caches for community data.
 * These persist across client-side navigations (SPA) without needing
 * React context, Redux, or external libraries.
 */

export interface CachedMessage {
  id: string;
  content: string;
  created_at: string;
  user_id: string;
  users: { name: string; avatar_url: string | null } | null;
  status?: "sending" | "sent" | "failed";
}

export interface CachedMeta {
  community: {
    id: string;
    name: string;
    type: string;
    member_count: number;
    image_url: string | null;
  };
  members: {
    user_id: string;
    users: { name: string; avatar_url: string | null } | null;
  }[];
  fetchedAt: number;
}

// ─── Sidebar joined-communities cache ─────────────────────────────────────────

export interface CachedSidebarCommunity {
  id: string;
  name: string;
  type: "city" | "sector" | "interest" | "company" | "experience_level";
  image_url: string | null;
  member_count: number;
  last_message: {
    content: string;
    created_at: string;
    user: { name: string } | null;
  } | null;
}

/**
 * Singleton cache for the joined-communities sidebar list (/api/communities).
 * Mutate `.data` and `.inflight` directly — the object reference is stable
 * so all importers always see the current values.
 */
export const sidebarStore: {
  data: { communities: CachedSidebarCommunity[]; fetchedAt: number } | null;
  inflight: Promise<void> | null;
} = { data: null, inflight: null };

/** How long before the joined-communities sidebar is considered stale */
export const SIDEBAR_STALE_MS = 60_000; // 1 minute

// ─── Explore Communities cache ────────────────────────────────────────────────

export interface CachedExploreCommunity {
  id: string;
  name: string;
  type: "city" | "sector" | "interest" | "company" | "experience_level";
  image_url: string | null;
  member_count: number;
  joined: boolean;
}

/**
 * Singleton cache for the Explore Communities page (/api/communities/all).
 * Same mutable-object pattern as sidebarStore.
 */
export const exploreStore: {
  data: { communities: CachedExploreCommunity[]; fetchedAt: number } | null;
  inflight: Promise<void> | null;
} = { data: null, inflight: null };

/** How long before the explore-communities list is considered stale */
export const EXPLORE_STALE_MS = 5 * 60_000; // 5 minutes

// ─── User-isolation helpers ───────────────────────────────────────────────────

/**
 * userId whose data currently lives in the module-level caches.
 * Checked on each CommunitiesPanel mount to detect account switches.
 */
export let cachedUserId: string | null = null;

/**
 * Call synchronously before reading any cache (e.g. in a useState initialiser).
 * If `userId` differs from `cachedUserId`, all caches are wiped first so that
 * User B never sees User A's data after an in-tab account switch.
 */
export function initUserCache(userId: string): void {
  if (userId && cachedUserId !== userId) {
    clearAllUserCaches();
    cachedUserId = userId;
  }
}

/**
 * Wipe every module-level cache. Call on logout and whenever the active user
 * changes. After this call, all components will fetch fresh data on next mount.
 */
export function clearAllUserCaches(): void {
  msgCache.clear();
  metaCache.clear();
  msgFetchedAt.clear();
  inFlightMsgFetch.clear();
  sidebarStore.data     = null;
  sidebarStore.inflight = null;
  exploreStore.data     = null;
  exploreStore.inflight = null;
  cachedUserId          = null;
}

// ─── Cache-invalidation helpers (join / leave) ────────────────────────────────

/**
 * Call after the current user successfully joins `communityId`.
 * Updates `joined` in the explore cache in place and clears the sidebar cache
 * so it refreshes with the new community on next render.
 */
export function invalidateOnJoin(communityId: string): void {
  if (exploreStore.data) {
    exploreStore.data = {
      ...exploreStore.data,
      communities: exploreStore.data.communities.map((c) =>
        c.id === communityId ? { ...c, joined: true } : c
      ),
    };
  }
  // Sidebar needs the new community's last_message info — easiest to refetch.
  sidebarStore.data     = null;
  sidebarStore.inflight = null;
}

/**
 * Call after the current user successfully leaves `communityId`.
 * Updates `joined` in the explore cache in place and removes the community
 * from the sidebar cache.
 */
export function invalidateOnLeave(communityId: string): void {
  if (exploreStore.data) {
    exploreStore.data = {
      ...exploreStore.data,
      communities: exploreStore.data.communities.map((c) =>
        c.id === communityId ? { ...c, joined: false } : c
      ),
    };
  }
  if (sidebarStore.data) {
    sidebarStore.data = {
      ...sidebarStore.data,
      communities: sidebarStore.data.communities.filter((c) => c.id !== communityId),
    };
  }
  // Also drop chat caches for the left community.
  msgCache.delete(communityId);
  metaCache.delete(communityId);
  msgFetchedAt.delete(communityId);
}

// ─── Existing chat caches (unchanged) ─────────────────────────────────────────

/** Messages keyed by communityId */
export const msgCache = new Map<string, CachedMessage[]>();

/** Community metadata (header + members panel) keyed by communityId */
export const metaCache = new Map<string, CachedMeta>();

/** Timestamp of the last successful full message fetch, keyed by communityId */
export const msgFetchedAt = new Map<string, number>();

/**
 * In-flight full-fetch promises keyed by communityId.
 * Hover prefetch and click both reuse the same promise — no duplicate requests.
 */
export const inFlightMsgFetch = new Map<string, Promise<void>>();

/** How long before community metadata is considered stale (ms) */
export const META_STALE_MS = 60_000; // 1 minute

/** How long before cached messages are considered stale (ms) */
export const MSG_STALE_MS = 30_000; // 30 seconds

/** Maximum number of communities to keep in each cache (FIFO eviction) */
export const MAX_CACHE_ENTRIES = 25;

/**
 * Evict the oldest entries from both caches when they exceed MAX_CACHE_ENTRIES.
 * Maps maintain insertion order, so the first key is the oldest.
 */
export function evictIfNeeded(): void {
  while (msgCache.size > MAX_CACHE_ENTRIES) {
    const oldest = msgCache.keys().next().value;
    if (!oldest) break;
    msgCache.delete(oldest);
    msgFetchedAt.delete(oldest);
  }
  while (metaCache.size > MAX_CACHE_ENTRIES) {
    const oldest = metaCache.keys().next().value;
    if (!oldest) break;
    metaCache.delete(oldest);
  }
}
