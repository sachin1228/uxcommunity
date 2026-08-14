/**
 * Client-side read-state manager for communities.
 *
 * Owns the decision of when to PATCH /api/communities/:id/read. Multiple UI
 * events — page open, component mount, tab focus, realtime message arrivals —
 * funnel through `scheduleMarkRead`, which collapses them into a single PATCH
 * and skips it entirely when nothing actually changed:
 *
 *   - 30s cooldown per community (no PATCH if marked read recently)
 *   - skip when the sidebar already reports 0 unread messages
 *   - debounce so bursts of events combine into one request
 *   - deduplicate while a PATCH is already in flight
 *
 * The in-memory cache is bounded: at most MAX_READ_STATE_ENTRIES communities
 * are tracked, so it cannot grow without limit during long-running sessions.
 * When the cap is exceeded, the oldest unused entry (no pending debounce
 * timer, no in-flight PATCH) is evicted.
 *
 * Realtime handlers feed `noteCommunityActivity` so the tracked unread count
 * stays fresh even before the user navigates back into a community.
 */

import { sidebarStore } from "./cache";
import { markReadOnServer } from "@/components/communities/panel/markReadOnServer";

export interface MarkReadOptions {
  /** Last known unread count from the sidebar projection. */
  unreadCount?: number | null;
  /** Newest known message created_at (kept fresh by realtime). */
  lastMessageTimestamp?: string | null;
  /** Human-readable trigger for dev logs. */
  reason?: string;
}

interface CommunityReadState {
  /** ms timestamp of the last PATCH sent for this community. */
  lastUpdatedAt: number | null;
  /** Highest unread count seen since the last mark-read. */
  unreadCount: number | null;
  /** Newest known message created_at. */
  lastMessageTimestamp: string | null;
  /** True while a PATCH is in flight for this community. */
  inFlight: boolean;
}

/**
 * Hard cap on the in-memory read-state cache. The map grows by one entry per
 * community the user interacts with, so without a bound it would grow
 * indefinitely across a long-running session. When the cap is exceeded, the
 * oldest unused entry is evicted (see `evictReadStatesIfNeeded`).
 */
export const MAX_READ_STATE_ENTRIES = 100;

/** Tuneable for tests. */
export const readManagerConfig = {
  cooldownMs: 30_000,
  debounceMs: 1_000,
  /** Max communities kept in memory; oldest unused entries are evicted past this. */
  maxEntries: MAX_READ_STATE_ENTRIES,
};

const readStates = new Map<string, CommunityReadState>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
let activeUserId: string | null = null;

function logReadCache(communityId: string, action: string, reason: string) {
  if (process.env.NODE_ENV === "production") return;
  console.info(`[READ CACHE] community: ${communityId} action: ${action} reason: ${reason}`);
}

function logReadNetwork(communityId: string, reason: string) {
  if (process.env.NODE_ENV === "production") return;
  console.info(`[READ NETWORK] community: ${communityId} reason: ${reason}`);
}

function ensureState(communityId: string): CommunityReadState {
  let state = readStates.get(communityId);
  if (!state) {
    state = {
      lastUpdatedAt: null,
      unreadCount: null,
      lastMessageTimestamp: null,
      inFlight: false,
    };
    readStates.set(communityId, state);
    evictReadStatesIfNeeded();
  } else {
    // Bump recency so the LRU eviction keeps communities the user is actively
    // interacting with (including realtime activity), not just the most
    // recently inserted ones.
    readStates.delete(communityId);
    readStates.set(communityId, state);
  }
  return state;
}

/**
 * Enforce the cache size cap. Iterates oldest → newest (Map insertion order is
 * refreshed by `ensureState` on every touch) and drops fully unused entries.
 * Communities with a pending debounce timer or an in-flight PATCH are
 * protected — evicting them would break the debounce/dedup guarantees.
 */
function evictReadStatesIfNeeded(): void {
  while (readStates.size > readManagerConfig.maxEntries) {
    let evicted = false;
    for (const [communityId, state] of readStates) {
      if (debounceTimers.has(communityId) || state.inFlight) continue;
      readStates.delete(communityId);
      logReadCache(communityId, "evicted", "cache at max size");
      evicted = true;
      break;
    }
    // Every remaining entry is protected (pending timer or in-flight request);
    // stop rather than evicting entries the debounce/dedup logic depends on.
    if (!evicted) break;
  }
}

/** Inspect the tracked state for a community (used by tests). */
export function getReadState(communityId: string): CommunityReadState | undefined {
  return readStates.get(communityId);
}

/** Clears all tracked state when the signed-in user changes. */
export function initReadManager(userId: string): void {
  if (userId && activeUserId !== userId) {
    resetReadManager();
    activeUserId = userId;
  }
}

export function resetReadManager(): void {
  for (const timer of debounceTimers.values()) clearTimeout(timer);
  debounceTimers.clear();
  readStates.clear();
  activeUserId = null;
}

function mergeActivity(
  communityId: string,
  opts: { unreadCount?: number | null; lastMessageTimestamp?: string | null },
): CommunityReadState {
  const state = ensureState(communityId);
  if (opts.unreadCount !== undefined && opts.unreadCount !== null) {
    // The optimistic badge-zeroing in the sidebar can report 0 for a community
    // that still has unread messages pending a mark-read, so keep the highest
    // count seen since the last PATCH.
    state.unreadCount = Math.max(state.unreadCount ?? 0, opts.unreadCount);
  }
  if (
    opts.lastMessageTimestamp &&
    (!state.lastMessageTimestamp ||
      opts.lastMessageTimestamp > state.lastMessageTimestamp)
  ) {
    state.lastMessageTimestamp = opts.lastMessageTimestamp;
  }
  return state;
}

/**
 * Record unread activity (e.g. a realtime message in a non-active community)
 * without scheduling a PATCH. Keeps the cache accurate for the next time the
 * user opens the community.
 */
export function noteCommunityActivity(
  communityId: string,
  activity: { unreadCount?: number | null; lastMessageTimestamp?: string | null },
): void {
  mergeActivity(communityId, activity);
}

/**
 * Request that a community be marked read. Multiple calls for the same
 * community within the debounce window collapse into one PATCH; the request is
 * skipped entirely when the cooldown is active, the badge already shows 0
 * unread, or a PATCH is already in flight.
 */
export function scheduleMarkRead(
  communityId: string,
  opts: MarkReadOptions = {},
): void {
  mergeActivity(communityId, opts);

  const reason = opts.reason ?? "event";
  const existing = debounceTimers.get(communityId);
  if (existing) {
    clearTimeout(existing);
    logReadCache(communityId, "debounced", `combined with pending request (${reason})`);
  } else {
    logReadCache(communityId, "scheduled", `event: ${reason}`);
  }
  debounceTimers.set(
    communityId,
    setTimeout(() => {
      debounceTimers.delete(communityId);
      fireMarkRead(communityId);
    }, readManagerConfig.debounceMs),
  );
}

/** Immediately run the pending decision for a community (bypasses debounce). */
export function flushMarkRead(communityId: string): void {
  const timer = debounceTimers.get(communityId);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(communityId);
    fireMarkRead(communityId);
  }
}

function fireMarkRead(communityId: string): void {
  const state = readStates.get(communityId);
  if (!state) return;

  // Deduplicate simultaneous requests: never stack a second PATCH while one
  // is in flight. The next event after the cooldown will re-request if needed.
  if (state.inFlight) {
    logReadCache(communityId, "skipped", "request already in flight (deduplicated)");
    return;
  }

  if (state.lastUpdatedAt !== null) {
    const elapsedMs = Date.now() - state.lastUpdatedAt;
    if (elapsedMs < readManagerConfig.cooldownMs) {
      logReadCache(
        communityId,
        "skipped",
        `already updated ${Math.floor(elapsedMs / 1000)}s ago`,
      );
      return;
    }
  }

  // When the unread count was never reported (e.g. the sidebar fetch is still
  // in flight on a fresh page load), consult the live sidebar projection,
  // which realtime keeps current.
  let unreadCount = state.unreadCount;
  if (unreadCount === null || unreadCount === undefined) {
    const live = sidebarStore.data?.communities.find((c) => c.id === communityId);
    if (live) unreadCount = live.message_count;
  }

  if (unreadCount === 0) {
    logReadCache(communityId, "skipped", "no unread messages");
    return;
  }

  state.inFlight = true;
  state.lastUpdatedAt = Date.now();
  logReadNetwork(
    communityId,
    unreadCount === null || unreadCount === undefined
      ? "unknown unread state"
      : "unread messages",
  );
  markReadOnServer(communityId)
    .catch(() => {})
    .finally(() => {
      const current = readStates.get(communityId);
      if (current) current.inFlight = false;
    });

  // Optimistic: the badge is cleared locally before the server responds.
  state.unreadCount = 0;
}
