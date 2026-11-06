import { dataEnvironment, assertServiceUrl } from "@uxcommunity/shared";
/**
 * Redis-backed sliding-window rate limiter using Upstash.
 *
 * Two production failure policies, chosen by the caller:
 *
 *   • strict (default) — authentication, account-abuse and security-sensitive
 *     write routes. A missing Upstash configuration is a deployment error and
 *     FAILS CLOSED: the request is refused rather than silently unthrottled.
 *     A transient Redis timeout, 5xx or exhausted quota falls back to a
 *     conservative per-isolate token window and is logged as degraded. That
 *     fallback is NOT globally distributed: each Worker isolate keeps its own
 *     counters, so the effective limit is per isolate. It is a stopgap that
 *     keeps the operation protected during an outage, not a replacement for
 *     Redis.
 *
 *   • availability — the global middleware guard and low-risk read/typing
 *     routes. A third-party outage must not lock every page load out of the
 *     app, so these fail open and are logged.
 *
 * A genuine "limit exceeded" verdict from Upstash always blocks, in both modes.
 *
 * Required env vars:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { logEvent } from "../observability/log";

export type RateLimitMode = "strict" | "availability";

export type RateLimitFailureReason =
  | "missing_config"
  | "timeout"
  | "server_error"
  | "quota"
  | "unknown";

export interface RateLimitOptions {
  /**
   * `strict` (default) for auth/abuse-sensitive routes; `availability` only
   * for the global guard and low-risk reads. See the module comment for the
   * exact production behaviour of each.
   */
  mode?: RateLimitMode;
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  /** Unix timestamp (ms) when the window resets. */
  resetAt: number;
  /** True when the verdict came from the local fallback, not Redis. */
  degraded?: boolean;
  /** Why the local fallback (or a fail-closed verdict) was used. */
  reason?: RateLimitFailureReason;
}

// Cache limiter instances by "limit:windowS" so we don't re-construct on
// every request (each construction creates a new Redis client).
const limiterCache = new Map<string, Ratelimit>();

function getLimiter(limit: number, windowS: number): Ratelimit {
  const cacheKey = `${limit}:${windowS}`;
  if (!limiterCache.has(cacheKey)) {
    const redis = new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    });
    limiterCache.set(
      cacheKey,
      new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(limit, `${windowS} s`),
        analytics: false,
      })
    );
  }
  return limiterCache.get(cacheKey)!;
}

/**
 * Per-isolate fallback windows. Bounded so a hostile key set cannot grow the
 * map without limit; the oldest expired windows are pruned on every call.
 *
 * This is deliberately kept small and local. It is not globally distributed:
 * two Worker isolates enforce two independent budgets. That is why strict
 * routes fail closed on missing configuration instead of treating this as a
 * full replacement for Upstash.
 */
const LOCAL_WINDOW_MAX_KEYS = 10_000;
const localWindows = new Map<string, { count: number; resetAt: number }>();

/**
 * A Redis call that never settles must not hold the route open. Upstash's
 * client retries some transport failures; the fallback is only useful if it
 * can run promptly, so a strict/availability timeout is treated like any
 * other infrastructure failure and classified as `timeout`.
 */
const REDIS_CALL_TIMEOUT_MS = 1_500;

class RateLimitTimeoutError extends Error {
  constructor() {
    super("rate-limit request timeout");
    this.name = "RateLimitTimeoutError";
  }
}

async function withRedisDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RateLimitTimeoutError()), REDIS_CALL_TIMEOUT_MS);
  });
  // The losing promise must not surface as an unhandled rejection when the
  // deadline wins and Upstash later fails.
  promise.catch(() => {});
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

function consumeLocalWindow(
  key: string,
  limit: number,
  windowS: number,
  mode: RateLimitMode,
  reason?: RateLimitFailureReason,
): RateLimitResult {
  const now = Date.now();
  for (const [k, v] of localWindows) {
    if (v.resetAt <= now) localWindows.delete(k);
  }

  const identity = `${key}:${limit}:${windowS}`;
  const window = localWindows.get(identity) ?? {
    count: 0,
    resetAt: now + windowS * 1000,
  };

  if (localWindows.size >= LOCAL_WINDOW_MAX_KEYS && !localWindows.has(identity)) {
    // The fallback map is full of live keys. Fail closed in strict mode; the
    // availability path keeps serving because its contract is uptime.
    return {
      success: mode === "availability",
      remaining: 0,
      resetAt: now + windowS * 1000,
      degraded: true,
      reason: reason ?? "unknown",
    };
  }

  window.count++;
  localWindows.set(identity, window);
  return {
    success: window.count <= limit,
    remaining: Math.max(0, limit - window.count),
    resetAt: window.resetAt,
    ...(reason ? { degraded: true, reason } : {}),
  };
}

export function classifyRateLimitFailure(error: unknown): RateLimitFailureReason {
  const status = Number(
    (error as { status?: unknown; statusCode?: unknown })?.status ??
      (error as { statusCode?: unknown })?.statusCode,
  );
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("etimedout") ||
    message.includes("aborted")
  ) {
    return "timeout";
  }
  if (
    status === 429 ||
    message.includes("quota") ||
    message.includes("max requests") ||
    message.includes("limit exceeded")
  ) {
    return "quota";
  }
  if (Number.isFinite(status) && status >= 500) return "server_error";
  return "unknown";
}

function logDegraded(
  mode: RateLimitMode,
  reason: RateLimitFailureReason,
  key: string,
  limit: number,
  windowS: number,
): void {
  // Never log the whole key: login keys contain emails and IP keys contain
  // addresses. The first segment names the operation without personal data.
  logEvent(reason === "missing_config" ? "error" : "warn", {
    event: "rate_limit.degraded",
    mode,
    reason,
    limit_name: key.split(":")[0],
    limit,
    window_s: windowS,
  });
}

/**
 * @param key      Unique identifier (e.g. "login:ip:1.2.3.4").
 * @param limit    Max requests allowed in the window.
 * @param windowS  Window duration in seconds.
 * @param options  `mode: "strict"` (default) or `"availability"`.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowS: number,
  options: RateLimitOptions = {},
): Promise<RateLimitResult> {
  const mode = options.mode ?? "strict";
  const environment = dataEnvironment(process.env);

  // Development and isolated test runs keep the local window: no third-party
  // dependency, no network wait, and a real counter rather than an always-allow.
  if (environment !== "production" && !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return consumeLocalWindow(key, limit, windowS, mode);
  }
  if (environment !== "production") {
    assertServiceUrl(process.env.UPSTASH_REDIS_REST_URL, process.env);
  }

  key = environment === "production" ? key : `${environment}:${key}`;

  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    logDegraded(mode, "missing_config", key, limit, windowS);
    if (mode === "availability") {
      return {
        success: true,
        remaining: limit,
        resetAt: Date.now() + windowS * 1000,
        degraded: true,
        reason: "missing_config",
      };
    }
    // Strict: refuse rather than run unthrottled. This is a configuration
    // error, not a transient outage; the deploy workflow requires both vars.
    return {
      success: false,
      remaining: 0,
      resetAt: Date.now() + windowS * 1000,
      degraded: true,
      reason: "missing_config",
    };
  }

  try {
    const limiter = getLimiter(limit, windowS);
    const result = await withRedisDeadline(limiter.limit(key));
    return {
      success: result.success,
      remaining: result.remaining,
      resetAt: result.reset, // Upstash returns reset as Unix ms
    };
  } catch (error) {
    const reason = classifyRateLimitFailure(error);
    logDegraded(mode, reason, key, limit, windowS);

    if (mode === "availability") {
      return {
        success: true,
        remaining: 0,
        resetAt: Date.now() + windowS * 1000,
        degraded: true,
        reason,
      };
    }

    // Strict: keep a conservative per-isolate budget while Redis is down.
    // The caller (and the deployment) must treat the log line as actionable:
    // this is weaker than Redis because each isolate counts separately.
    return consumeLocalWindow(key, limit, windowS, mode, reason);
  }
}
