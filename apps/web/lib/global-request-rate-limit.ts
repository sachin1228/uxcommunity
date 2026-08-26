import type { NextRequest } from "next/server";
import { rateLimit, type RateLimitResult } from "@/lib/auth/rate-limit";

/**
 * Global request protection is intentionally generous for normal page loads,
 * but catches browser refresh/navigation loops before they become expensive.
 */
export const GLOBAL_REQUEST_LIMITS = {
  burst: { limit: 40, windowS: 10 },
  sustained: { limit: 240, windowS: 60 },
} as const;

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
  const [burst, sustained] = await Promise.all([
    rateLimit(
      `global-request:burst:${key}`,
      GLOBAL_REQUEST_LIMITS.burst.limit,
      GLOBAL_REQUEST_LIMITS.burst.windowS
    ),
    rateLimit(
      `global-request:sustained:${key}`,
      GLOBAL_REQUEST_LIMITS.sustained.limit,
      GLOBAL_REQUEST_LIMITS.sustained.windowS
    ),
  ]);

  const failedLimit = [burst, sustained].find((result) => !result.success);
  const remaining = Math.min(burst.remaining, sustained.remaining);

  return {
    success: !failedLimit,
    remaining,
    resetAt: failedLimit?.resetAt ?? Math.max(burst.resetAt, sustained.resetAt),
  } satisfies GlobalRequestRateLimitResult;
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
