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

/** Tuneable for tests. */
export const readManagerConfig = {
  cooldownMs: 30_000,
  debounceMs: 1_000,
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
  }
  return state;
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
