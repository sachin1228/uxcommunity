/**
 * Client-side read-state manager for community chats — the React Native port
 * of the web read-manager (apps/web/lib/read-manager.ts).
 *
 * Multiple events — opening a chat, a realtime message arriving while it is on
 * screen — funnel through scheduleMarkRead, which collapses bursts into a
 * single PATCH /read and skips pointless ones: a busy room must not cost one
 * Worker invocation per message.
 *
 *   - a 1s debounce folds bursts of arrivals into one request
 *   - a 30s cooldown gates REALTIME-triggered PATCHes (a message arriving in
 *     the open chat must not PATCH per event); opening the chat bypasses the
 *     cooldown so the badge always clears
 *   - while a PATCH is in flight, new activity schedules exactly one follow-up
 *   - a failed PATCH retries with backoff (bounded), because the caller has
 *     already zeroed the badge locally — a silent drop would resurrect it
 *   - the per-community state is bounded (oldest unused evicted), so a long
 *     session across many communities cannot grow it forever
 *
 * The PATCH itself is INJECTED via the `patch` option (callers pass the api
 * client's markRead), so this module stays free of the API layer and runs
 * under plain Node in the test suite.
 */

export const readManagerConfig = {
  cooldownMs: 30_000,
  debounceMs: 1_000,
  /** Delay before retrying a failed mark-read PATCH (multiplied by attempt). */
  retryMs: 3_000,
  /** Max consecutive retries per community before the next event re-arms it. */
  maxRetries: 2,
  /** Max communities tracked in memory; oldest unused entries are evicted. */
  maxEntries: 100,
};

type MarkReadPatch = (communityId: string) => Promise<void>;

interface ReadState {
  /** ms timestamp of the last PATCH sent for this community. */
  lastUpdatedAt: number | null;
  /** True while a PATCH is in flight for this community. */
  inFlight: boolean;
  /** Set when activity arrived while a PATCH was in flight. */
  followUpPending: boolean;
  /** Consecutive failed PATCHes (bounded retry with backoff). */
  failures: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

const states = new Map<string, ReadState>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

function ensureState(communityId: string): ReadState {
  let state = states.get(communityId);
  if (!state) {
    state = {
      lastUpdatedAt: null,
      inFlight: false,
      followUpPending: false,
      failures: 0,
      retryTimer: null,
    };
    states.set(communityId, state);
    evictReadStatesIfNeeded();
  } else {
    // Bump recency so eviction keeps the communities actually in use.
    states.delete(communityId);
    states.set(communityId, state);
  }
  return state;
}

/** Drops the oldest fully-idle entry past the cap; entries with a pending
 *  timer, an in-flight PATCH or a scheduled retry are protected. */
function evictReadStatesIfNeeded(): void {
  while (states.size > readManagerConfig.maxEntries) {
    let evicted = false;
    for (const [communityId, state] of states) {
      if (debounceTimers.has(communityId) || state.inFlight || state.retryTimer !== null) {
        continue;
      }
      states.delete(communityId);
      evicted = true;
      break;
    }
    if (!evicted) break;
  }
}

/** Inspect the tracked state for a community (used by tests). */
export function getReadState(communityId: string): ReadState | undefined {
  return states.get(communityId);
}

/** Clears all tracked state and timers (account switch, sign-out). */
export function resetReadManager(): void {
  for (const timer of debounceTimers.values()) clearTimeout(timer);
  debounceTimers.clear();
  for (const state of states.values()) {
    if (state.retryTimer) clearTimeout(state.retryTimer);
  }
  states.clear();
}

/**
 * Request that a community be marked read. Calls within the debounce window
 * collapse into one PATCH; `bypassCooldown` is set by user opens so reopening
 * a chat always clears the badge.
 */
export function scheduleMarkRead(
  communityId: string,
  { bypassCooldown = false, patch }: { bypassCooldown?: boolean; patch: MarkReadPatch },
): void {
  ensureState(communityId);

  const existing = debounceTimers.get(communityId);
  if (existing) clearTimeout(existing);
  debounceTimers.set(
    communityId,
    setTimeout(() => {
      debounceTimers.delete(communityId);
      fireMarkRead(communityId, { bypassCooldown, patch });
    }, readManagerConfig.debounceMs),
  );
}

function fireMarkRead(
  communityId: string,
  { bypassCooldown, patch }: { bypassCooldown: boolean; patch: MarkReadPatch },
): void {
  const state = states.get(communityId);
  if (!state) return;

  // Never stack a second PATCH while one is in flight; activity that arrived
  // meanwhile schedules exactly one follow-up.
  if (state.inFlight) {
    state.followUpPending = true;
    return;
  }

  if (!bypassCooldown && state.lastUpdatedAt !== null) {
    const elapsedMs = Date.now() - state.lastUpdatedAt;
    if (elapsedMs < readManagerConfig.cooldownMs) return;
  }

  state.inFlight = true;
  state.lastUpdatedAt = Date.now();
  patch(communityId)
    .then(() => {
      const current = states.get(communityId);
      if (!current) return;
      current.inFlight = false;
      current.failures = 0;
      if (current.followUpPending) {
        current.followUpPending = false;
        scheduleMarkRead(communityId, { patch });
      }
    })
    .catch(() => {
      const current = states.get(communityId);
      if (!current) return;
      current.inFlight = false;
      // The badge is already zeroed locally, so a silent give-up would
      // resurrect it on the next list refresh — retry with backoff, bounded.
      if (current.failures < readManagerConfig.maxRetries) {
        current.failures += 1;
        current.retryTimer = setTimeout(() => {
          current.retryTimer = null;
          fireMarkRead(communityId, { bypassCooldown: true, patch });
        }, readManagerConfig.retryMs * current.failures);
      }
    });
}
