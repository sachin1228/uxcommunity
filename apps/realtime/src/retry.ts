/**
 * Bounded retry with exponential backoff for the realtime publish fan-out.
 *
 * WHY THIS EXISTS (production-readiness audit, M-1)
 *   A publish reaches a room by `stub.fetch()` from the Worker to the room's
 *   Durable Object. That call is fire-and-forget inside `ctx.waitUntil`, so a
 *   transient failure (the DO momentarily unavailable, a 5xx, a connection
 *   reset) used to mean the event was silently never delivered to that room —
 *   the publisher still got "ok", and a client that never reconnects or
 *   refocuses never resyncs.
 *
 *   A retry is only safe because retries reuse the event's `event_id` and the
 *   room DO drops a delivery it has already applied (see `event-dedupe.ts`), so
 *   a retry that races a successful first attempt cannot double-fan-out.
 *
 * WHAT THIS IS NOT
 *   This is not a durable queue. It absorbs a short transient blip; it cannot
 *   promise delivery across a multi-second outage. The durability boundary is
 *   documented in `apps/realtime/src/index.ts` (fanOutEvents).
 *
 * Kept dependency-free so the policy can be unit-tested without a Worker.
 */

export interface RetryPolicy {
  /** Total attempts including the first. Clamped to >= 1. */
  attempts: number;
  /** Delay before the second attempt; doubled each further attempt. */
  baseDelayMs: number;
  /** Upper bound on the exponential term. */
  maxDelayMs: number;
  /** Fraction of the delay applied as symmetric jitter (0..1). */
  jitter?: number;
}

export interface RetryDeps {
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Called before each retry wait — used for structured retry logging. */
  onRetry?: (info: { attempt: number; delayMs: number }) => void;
}

const DEFAULT_SLEEP = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Delay before `attempt` (1-based, i.e. the wait that precedes attempt 2 is
 * computed with attempt = 1). Grows exponentially, capped, plus symmetric
 * jitter so a fleet of retries does not synchronise into a thundering herd.
 */
export function backoffDelay(
  attempt: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(
    policy.baseDelayMs * 2 ** Math.max(0, attempt - 1),
    policy.maxDelayMs,
  );
  const jitter = Math.max(0, Math.min(1, policy.jitter ?? 0.25));
  const spread = exponential * jitter;
  const delay = exponential - spread + random() * spread * 2;
  return Math.max(0, Math.round(delay));
}

/**
 * Run `operation`, retrying while `shouldRetry` says the outcome is transient.
 *
 * Resolves with the operation's value as soon as it is acceptable (or the
 * attempts are exhausted). Re-throws the last error when the operation keeps
 * throwing and no attempt remains — a caller that ignores the rejection logs it
 * rather than pretending delivery happened.
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  policy: RetryPolicy,
  shouldRetry: (outcome: { value?: T; error?: unknown }, attempt: number) => boolean,
  deps: RetryDeps = {},
): Promise<T> {
  const sleep = deps.sleep ?? DEFAULT_SLEEP;
  const attempts = Math.max(1, Math.floor(policy.attempts));
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const value = await operation();
      if (attempt >= attempts || !shouldRetry({ value }, attempt)) return value;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !shouldRetry({ error }, attempt)) throw error;
    }
    const delayMs = backoffDelay(attempt, policy, deps.random);
    deps.onRetry?.({ attempt, delayMs });
    await sleep(delayMs);
  }

  // Unreachable for attempts >= 1 (the loop returns or throws), kept for types.
  throw lastError ?? new Error("retryWithBackoff exhausted without a result");
}

/**
 * Transient statuses worth retrying: server errors and throttling. A 4xx
 * (other than 429) means the request itself is wrong, so retrying cannot help.
 */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
