/**
 * Retry policy for the durable outbox.
 *
 * Every queued message is retried with exponential backoff plus jitter, capped
 * at a bounded number of attempts so a permanently broken payload cannot spin
 * forever. The distinction that matters is not "network vs server" but "will
 * the SAME request ever succeed?":
 *
 *   * `retry`      — transport failure, 408, 5xx, 425. The request may land.
 *   * `rate-limit` — 429. Honour Retry-After; still the same logical send.
 *   * `auth`       — 401. The session expired. Do not burn attempt budget:
 *                    pause, let the app's refresh/re-auth flow run, retry.
 *   * `permanent`  — 400/403/404/409/410/422 and any other 4xx. Permissions,
 *                    membership, block state or the payload itself is wrong;
 *                    retrying cannot help. The bubble must become `failed`
 *                    with a manual retry (which revalidates on the server).
 */
export type FailureKind = "retry" | "rate-limit" | "auth" | "permanent";

export const OUTBOX_MAX_ATTEMPTS = 6;
export const OUTBOX_BASE_DELAY_MS = 2_000;
export const OUTBOX_MAX_DELAY_MS = 60_000;
/** How long one worker may own a record before another may reclaim it. */
export const OUTBOX_LEASE_MS = 30_000;
/** A 401 pauses the queue instead of failing it (session refresh may recover). */
export const OUTBOX_AUTH_PAUSE_MS = 30_000;

export function classifyStatus(status: number): FailureKind {
  if (status === 401) return "auth";
  if (status === 429) return "rate-limit";
  if (status === 408 || status === 425 || status >= 500) return "retry";
  return "permanent";
}

/**
 * Exponential delay with symmetric jitter: attempt 1 ≈ 2s, 2 ≈ 4s, 3 ≈ 8s …
 * capped at a minute. Jitter is ±20%, so a reconnect storm from many devices
 * does not deliver every retry in the same millisecond.
 */
export function retryDelayMs(
  attempt: number,
  random: () => number = Math.random,
): number {
  const exponent = Math.max(0, attempt - 1);
  const base = Math.min(OUTBOX_BASE_DELAY_MS * 2 ** exponent, OUTBOX_MAX_DELAY_MS);
  const jitter = (random() * 2 - 1) * 0.2;
  // Jitter may shorten or lengthen the wait, but the configured ceiling is a
  // ceiling: a 60 s max must not become 72 s.
  return Math.max(0, Math.min(Math.round(base * (1 + jitter)), OUTBOX_MAX_DELAY_MS));
}

/** Parse a Retry-After header value (seconds or HTTP date) into milliseconds. */
export function parseRetryAfterMs(
  value: string | null | undefined,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Math.round(Number(trimmed) * 1000));
  }
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now);
}

export function shouldRetry(record: { attempts: number }, maxAttempts = OUTBOX_MAX_ATTEMPTS): boolean {
  return record.attempts < maxAttempts;
}
