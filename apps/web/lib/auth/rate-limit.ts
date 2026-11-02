import { dataEnvironment, assertServiceUrl } from "@uxcommunity/shared";
/**
 * Redis-backed sliding-window rate limiter using Upstash.
 *
 * Replaces the previous in-memory Map implementation, which did not work
 * correctly in serverless / multi-instance deployments (each instance had its
 * own memory, so attempts were spread across instances and the limit never
 * triggered reliably).
 *
 * A genuine "limit exceeded" verdict from Upstash still blocks the request.
 * Infrastructure failures — missing configuration, an unreachable Redis, an
 * exhausted Upstash quota — fail open and are logged, so a third-party outage
 * cannot lock members out of login or the API. The global middleware limiter
 * has always used this availability-oriented fallback.
 *
 * Required env vars:
 *   UPSTASH_REDIS_REST_URL
 *   UPSTASH_REDIS_REST_TOKEN
 */

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

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

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  /** Unix timestamp (ms) when the window resets. */
  resetAt: number;
}

/**
 * @param key      Unique identifier (e.g. "login:ip:1.2.3.4").
 * @param limit    Max requests allowed in the window.
 * @param windowS  Window duration in seconds.
 */
const localWindows = new Map<string, { count: number; resetAt: number }>();

export async function rateLimit(
  key: string,
  limit: number,
  windowS: number,
): Promise<RateLimitResult> {
  const mode = dataEnvironment(process.env);
  if (mode !== "production" && !process.env.UPSTASH_REDIS_REST_TOKEN) {
    const now = Date.now();
    for (const [k, v] of localWindows) if (v.resetAt <= now) localWindows.delete(k);
    const identity = `${key}:${limit}:${windowS}`;
    const window = localWindows.get(identity) ?? { count: 0, resetAt: now + windowS * 1000 };
    if (localWindows.size >= 10000 && !localWindows.has(identity)) {
      return { success: false, remaining: 0, resetAt: now + windowS * 1000 };
    }
    window.count++;
    localWindows.set(identity, window);
    return { success: window.count <= limit, remaining: Math.max(0, limit - window.count), resetAt: window.resetAt };
  }
  if (mode !== "production") assertServiceUrl(process.env.UPSTASH_REDIS_REST_URL, process.env);
  key = mode === "production" ? key : `${mode}:${key}`;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
    return {
      success: true,
      remaining: limit,
      resetAt: Date.now() + windowS * 1000,
    };
  }

  try {
    const limiter = getLimiter(limit, windowS);
    const result = await limiter.limit(key);
    return {
      success: result.success,
      remaining: result.remaining,
      resetAt: result.reset, // Upstash returns reset as Unix ms
    };
  } catch (err) {
    console.error("[rate-limit] Redis unavailable; failing open:", err);
    return {
      success: true,
      remaining: 0,
      resetAt: Date.now() + windowS * 1000,
    };
  }
}
