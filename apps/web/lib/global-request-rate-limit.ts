import type { NextRequest } from "next/server";
import { rateLimit, type RateLimitResult } from "@/lib/auth/rate-limit";
import type { createServerTimer } from "@/lib/server-timing";

type LimitOptions = {
  limit?: typeof rateLimit;
  timer?: Pick<ReturnType<typeof createServerTimer>, "measure">;
};

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

async function checkSustainedLimit(key: string, limit: typeof rateLimit): Promise<RateLimitResult> {
  const now = Date.now();
  const cached = sustainedVerdicts.get(key);
  if (cached && now - cached.checkedAt < SUSTAINED_VERDICT_TTL_MS) {
    // remaining is unknown without a Redis read; the header stays conservative.
    return { success: true, remaining: -1, resetAt: cached.resetAt };
  }

  const result = await limit(
    `global-request:sustained:${key}`,
    GLOBAL_REQUEST_LIMITS.sustained.limit,
    GLOBAL_REQUEST_LIMITS.sustained.windowS,
    { mode: "availability" },
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
 * The client address for rate-limit keys.
 *
 * Cloudflare's `cf-connecting-ip` is the only header the edge sets itself.
 * `x-forwarded-for` is client-supplied and may be prepended, so it is only a
 * fallback for local/self-hosted runs — never the first choice behind the edge.
 */
export function getRequestClientIp(
  request: Pick<NextRequest, "headers">
): string {
  const forwardedIp =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip");

  return forwardedIp || "unknown";
}

/**
 * Prefer an authenticated user key so users behind the same NAT are isolated.
 * For public pages, use the trusted client address.
 */
export function getGlobalRequestKey(
  request: Pick<NextRequest, "headers">,
  userId?: string | null
): string {
  if (userId) return `user:${userId}`;
  return `ip:${getRequestClientIp(request)}`;
}

export async function checkGlobalRequestRateLimit(
  key: string,
  { limit = rateLimit, timer }: LimitOptions = {},
): Promise<GlobalRequestRateLimitResult> {
  const measure = <T>(name: string, operation: () => Promise<T>) =>
    timer ? timer.measure(name, operation) : operation();
  // Independent windows share one network wait. Neither quota is weakened.
  const [burst, sustained] = await Promise.all([
    measure("global_burst", () => limit(
      `global-request:burst:${key}`,
      GLOBAL_REQUEST_LIMITS.burst.limit,
      GLOBAL_REQUEST_LIMITS.burst.windowS,
      { mode: "availability" },
    )),
    measure("global_sustained", () => checkSustainedLimit(key, limit)),
  ]);
  if (!burst.success) {
    sustainedVerdicts.delete(key);
    return {
      success: false,
      remaining: burst.remaining,
      resetAt: burst.resetAt,
    };
  }

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
