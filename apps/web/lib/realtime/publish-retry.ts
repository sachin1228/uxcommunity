/**
 * Bounded retry with exponential backoff for the web → realtime Worker publish
 * hop (production-readiness audit, M-1).
 *
 * The publish POST used to be a single best-effort `fetch`: a transient network
 * error or a 5xx from the realtime Worker meant the event was never handed off,
 * and the publisher still considered it sent. This retries only TRANSIENT
 * outcomes (thrown fetch errors, 429/5xx); a 4xx is permanent.
 *
 * Retries are safe because each publish carries a stable `event_id` and the
 * room DO de-duplicates by it — a retry that races a first attempt that
 * actually landed cannot double-deliver. Like the realtime worker's copy
 * (`apps/realtime/src/retry.ts`), this is a retry, not a durable queue.
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
  onRetry?: (info: { attempt: number; delayMs: number }) => void;
}

const DEFAULT_SLEEP = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Delay before `attempt` (1-based), exponential, capped, with jitter. */
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
  return Math.max(0, Math.round(exponential - spread + random() * spread * 2));
}

/** Server errors and throttling are worth retrying; other 4xx are not. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

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

  throw lastError ?? new Error("retryWithBackoff exhausted without a result");
}
