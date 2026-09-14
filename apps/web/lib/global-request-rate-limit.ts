import type { NextRequest } from "next/server";
import { rateLimit, type RateLimitResult } from "@/lib/auth/rate-limit";

/**
 * Global request protection is intentionally generous for normal page loads,
 * but catches browser refresh/navigation loops before they become expensive.
 */
export const GLOBAL_REQUEST_LIMITS = {
  burst: { limit: 50, windowS: 10 },
  sustained: { limit: 300, windowS: 60 },
} as const;

/**
 * The middleware runs on EVERY page and API request, and each Upstash round
 * trip is paid in request latency. Both windows stay enforced, but only the
 * burst window (the one that actually stops refresh/navigation storms) is
 * checked on every request. The coarse sustained quota's "allowed" verdict is
 * cached per worker for a couple of seconds, so a typical request costs ONE
 * Redis round trip instead of two while a flood still trips the burst limiter
 * immediately and the sustained limiter at most ~2s late per worker.
 */
const SUSTAINED_VERDICT_TTL_MS = 2_000;
const SUSTAINED_VERDICT_MAX_ENTRIES = 5_000;

const sustainedVerdicts = new Map<string, { resetAt: number; checkedAt: number }>();

async function checkSustainedLimit(key: string): Promise<RateLimitResult> {
  const now = Date.now();
  const cached = sustainedVerdicts.get(key);
  if (cached && now - cached.checkedAt < SUSTAINED_VERDICT_TTL_MS) {
    // remaining is unknown without a Redis read; the header stays conservative.
    return { success: true, remaining: -1, resetAt: cached.resetAt };
  }

  const result = await rateLimit(
    `global-request:sustained:${key}`,
    GLOBAL_REQUEST_LIMITS.sustained.limit,
    GLOBAL_REQUEST_LIMITS.sustained.windowS
  );
  if (result.success) {
    sustainedVerdicts.set(key, { resetAt: result.resetAt, checkedAt: now });
    if (sustainedVerdicts.size > SUSTAINED_VERDICT_MAX_ENTRIES) {
      // Map preserves insertion order — evict the oldest cached verdicts.
      for (const oldest of sustainedVerdicts.keys()) {
        sustainedVerdicts.delete(oldest);
        if (sustainedVerdicts.size <= SUSTAINED_VERDICT_MAX_ENTRIES) break;
      }
    }
  } else {
    sustainedVerdicts.delete(key);
  }
  return result;
}

export interface GlobalRequestRateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * Prefer an authenticated user key so users behind the same NAT are isolated.
 * For public pages, use the first address from the trusted proxy headers.
 */
export function getGlobalRequestKey(
  request: Pick<NextRequest, "headers">,
  userId?: string | null
): string {
  if (userId) return `user:${userId}`;

  const forwardedIp =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip");

  return `ip:${forwardedIp || "unknown"}`;
}

export async function checkGlobalRequestRateLimit(
  key: string
): Promise<GlobalRequestRateLimitResult> {
  // Burst window: strict, checked on every request.
  const burst = await rateLimit(
    `global-request:burst:${key}`,
    GLOBAL_REQUEST_LIMITS.burst.limit,
    GLOBAL_REQUEST_LIMITS.burst.windowS
  );
  if (!burst.success) {
    sustainedVerdicts.delete(key);
    return {
      success: false,
      remaining: burst.remaining,
      resetAt: burst.resetAt,
    };
  }

  // Sustained window: verified against Redis at most every TTL per worker.
  const sustained = await checkSustainedLimit(key);
  if (!sustained.success) {
    return {
      success: false,
      remaining: Math.min(burst.remaining, sustained.remaining),
      resetAt: sustained.resetAt,
    };
  }

  return {
    success: true,
    remaining: burst.remaining,
    resetAt: Math.max(burst.resetAt, sustained.resetAt),
  };
}

export function retryAfterSeconds(resetAt: number): string {
  return String(Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)));
}

export function getRateLimitHeaders(
  result: Pick<RateLimitResult, "remaining" | "resetAt">
): Record<string, string> {
  return {
    "Cache-Control": "no-store",
    "Retry-After": retryAfterSeconds(result.resetAt),
    "X-RateLimit-Limit": String(GLOBAL_REQUEST_LIMITS.sustained.limit),
    "X-RateLimit-Remaining": String(Math.max(0, result.remaining)),
    "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
  };
}
