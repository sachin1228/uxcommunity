/**
 * Redis-backed sliding-window rate limiter using Upstash.
 *
 * Replaces the previous in-memory Map implementation, which did not work
 * correctly in serverless / multi-instance deployments (each instance had its
 * own memory, so attempts were spread across instances and the limit never
 * triggered reliably).
 *
 * Fail-open policy: if Redis is unreachable the request is allowed through and
 * the error is logged. This keeps the app available during Redis outages at the
 * cost of rate-limiting not being enforced. If you prefer fail-closed, replace
 * the catch branch with { success: false, remaining: 0, resetAt: ... }.
 *
 * Required env vars (see .env.example):
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
export async function rateLimit(
  key: string,
  limit: number,
  windowS: number
): Promise<RateLimitResult> {
  try {
    const limiter = getLimiter(limit, windowS);
    const result = await limiter.limit(key);
    return {
      success: result.success,
      remaining: result.remaining,
      resetAt: result.reset, // Upstash returns reset as Unix ms
    };
  } catch (err) {
    // Fail open — allow the request through if Redis is unavailable.
    console.error("[rate-limit] Redis unreachable, failing open:", err);
    return {
      success: true,
      remaining: 0,
      resetAt: Date.now() + windowS * 1000,
    };
  }
}
