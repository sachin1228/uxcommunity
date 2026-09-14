/**
 * Client-side read-state manager for communities.
 *
 * Owns the decision of when to PATCH /api/communities/:id/read. Multiple UI
 * events — page open, component mount, tab focus, realtime message arrivals —
 * funnel through `scheduleMarkRead`, which collapses them into a single PATCH
 * and skips it entirely when nothing actually changed:
 *
 *   - 30s cooldown per community for REALTIME-triggered mark-reads (a message
 *     arriving in the active community must not PATCH on every event). Opened
 *     by the user → bypass the cooldown: re-opening a community within 30s
 *     must still clear its badge, or the next sidebar refetch resurrects it.
 *   - skip when the sidebar already reports 0 unread messages
 *   - debounce so bursts of events combine into one request
 *   - deduplicate while a PATCH is already in flight — but new unread activity
 *     that arrives during the request schedules one follow-up PATCH
 *   - one retry with backoff when the PATCH fails (the badge is already
 *     zeroed locally, so a silent failure would resurrect the unread count)
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
  /**
   * True for USER-initiated opens (sidebar click, route change) — bypasses the
   * cooldown so re-opening a community always marks it read. Realtime-triggered
   * mark-reads leave this unset and stay cooldown-gated.
   */
  bypassCooldown?: boolean;
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
  /** Set when unread activity arrived while a PATCH was in flight. */
  followUpPending: boolean;
  /** Number of consecutive failed PATCHes (retry with backoff, capped). */
  failures: number;
  /** Timer for the failure retry backoff. */
  retryTimer: ReturnType<typeof setTimeout> | null;
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
  /** Delay before retrying a failed mark-read PATCH. */
  retryMs: 3_000,
  /** Max consecutive retries per community before giving up until the next event. */
  maxRetries: 2,
};

const readStates = new Map<string, CommunityReadState>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
let activeUserId: string | null = null;

function ensureState(communityId: string): CommunityReadState {
  let state = readStates.get(communityId);
  if (!state) {
    state = {
      lastUpdatedAt: null,
      unreadCount: null,
      lastMessageTimestamp: null,
      inFlight: false,
      followUpPending: false,
      failures: 0,
      retryTimer: null,
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
 * Communities with a pending debounce timer, an in-flight PATCH, or a scheduled
 * retry are protected — evicting them would break the debounce/retry guarantees.
 */
function evictReadStatesIfNeeded(): void {
  while (readStates.size > readManagerConfig.maxEntries) {
    let evicted = false;
    for (const [communityId, state] of readStates) {
      if (
        debounceTimers.has(communityId) ||
        state.inFlight ||
        state.retryTimer !== null
      ) {
        continue;
      }
      readStates.delete(communityId);
      evicted = true;
      break;
    }
    // Every remaining entry is protected; stop rather than evict entries the
    // debounce/retry logic depends on.
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
  for (const state of readStates.values()) {
    if (state.retryTimer) clearTimeout(state.retryTimer);
  }
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
 * skipped when the unread count is already 0, the realtime cooldown is active,
 * or a PATCH is in flight (that one schedules a follow-up instead).
 */
export function scheduleMarkRead(
  communityId: string,
  opts: MarkReadOptions = {},
): void {
  mergeActivity(communityId, opts);

  // A user-open supersedes any pending realtime cooldown/retry backoff.
  const state = ensureState(communityId);
  if (opts.bypassCooldown && state.retryTimer !== null) {
    clearTimeout(state.retryTimer);
    state.retryTimer = null;
  }

  const existing = debounceTimers.get(communityId);
  if (existing) {
    clearTimeout(existing);
  }
  const bypass = opts.bypassCooldown === true;
  debounceTimers.set(
    communityId,
    setTimeout(() => {
      debounceTimers.delete(communityId);
      fireMarkRead(communityId, { bypassCooldown: bypass });
    }, readManagerConfig.debounceMs),
  );
}

/** Immediately run the pending decision for a community (bypasses debounce). */
export function flushMarkRead(communityId: string): void {
  const timer = debounceTimers.get(communityId);
  if (timer) {
    clearTimeout(timer);
    debounceTimers.delete(communityId);
    fireMarkRead(communityId, { bypassCooldown: true });
  }
}

function fireMarkRead(
  communityId: string,
  { bypassCooldown = false }: { bypassCooldown?: boolean } = {},
): void {
  const state = readStates.get(communityId);
  if (!state) return;

  // Deduplicate simultaneous requests: never stack a second PATCH while one
  // is in flight. If new unread activity arrived during the request, schedule
  // exactly one follow-up so it is never lost.
  if (state.inFlight) {
    if ((state.unreadCount ?? 0) > 0) state.followUpPending = true;
    return;
  }

  if (!bypassCooldown && state.lastUpdatedAt !== null) {
    const elapsedMs = Date.now() - state.lastUpdatedAt;
    if (elapsedMs < readManagerConfig.cooldownMs) {
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
    return;
  }

  state.inFlight = true;
  state.lastUpdatedAt = Date.now();
  markReadOnServer(communityId)
    .then((ok) => {
      const current = readStates.get(communityId);
      if (!current) return;
      current.inFlight = false;
      if (ok) {
        current.failures = 0;
        // The PATCH succeeded — the server now agrees the community is read.
        current.unreadCount = 0;
        if (current.followUpPending) {
          current.followUpPending = false;
          if ((current.unreadCount ?? 0) > 0) {
            debounceTimers.set(
              communityId,
              setTimeout(() => {
                debounceTimers.delete(communityId);
                fireMarkRead(communityId);
              }, readManagerConfig.debounceMs),
            );
          }
        }
      } else if (current.failures < readManagerConfig.maxRetries) {
        // Failure — the badge is already zeroed locally, so a silent give-up
        // would resurrect the unread count on the next sidebar refetch.
        // Retry with backoff (bounded).
        current.failures += 1;
        current.retryTimer = setTimeout(() => {
          current.retryTimer = null;
          fireMarkRead(communityId, { bypassCooldown: true });
        }, readManagerConfig.retryMs * current.failures);
      }
    })
    .catch(() => {
      const current = readStates.get(communityId);
      if (current) current.inFlight = false;
    })
    .finally(() => {
      const current = readStates.get(communityId);
      if (current) current.inFlight = false;
    });
}
