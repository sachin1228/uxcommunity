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
 * The Cloudflare native rate-limiting binding (wrangler `[[ratelimits]]`,
 * GLOBAL_REQUEST_BURST_LIMITER). Its counters are cached on the same machine
 * the Worker runs in, so `limit()` adds no network hop — where the Upstash
 * fallback pays a cross-region HTTPS round trip on every request. The binding
 * is per-location (see the Cloudflare docs): for the burst window that is the
 * intent — it stops a refresh/navigation storm at the colo the storm is
 * coming from — while the sustained quota below keeps counting across
 * locations in Upstash.
 */
type BurstLimiterBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

/**
 * `undefined` = not looked up yet, `null` = looked up and unavailable (local
 * dev, or a deployment without the binding). Latched so the lookup cost and
 * the one-off warning are paid at most once per worker isolate.
 */
let burstBinding: BurstLimiterBinding | null | undefined;

async function getBurstBinding(): Promise<BurstLimiterBinding | null> {
  if (burstBinding !== undefined) return burstBinding;
  try {
    // Dynamic + subpath import: the middleware bundle only pulls in this
    // tiny module (never the whole builder package). `getCloudflareContext`
    // throws outside a Worker request (next dev), which is the fallback path.
    const { getCloudflareContext } = await import("@opennextjs/cloudflare/cloudflare-context");
    const env = getCloudflareContext().env as Record<string, unknown>;
    burstBinding =
      (env.GLOBAL_REQUEST_BURST_LIMITER as BurstLimiterBinding | undefined) ?? null;
  } catch {
    burstBinding = null;
  }
  if (!burstBinding) {
    console.warn(
      "[rate-limit] GLOBAL_REQUEST_BURST_LIMITER binding unavailable — burst window falls back to Upstash (one Redis round trip per request).",
    );
  }
  return burstBinding;
}

/**
 * The burst window, on the native binding when deployed on Cloudflare and on
 * Upstash everywhere else. `remaining`/`resetAt` are approximate on the
 * binding path (the API returns only success), so headers stay conservative —
 * same contract as the cached sustained verdict below.
 */
async function checkBurstLimit(key: string): Promise<RateLimitResult> {
  const binding = await getBurstBinding();
  if (binding) {
    const resetAt = Date.now() + GLOBAL_REQUEST_LIMITS.burst.windowS * 1_000;
    try {
      const { success } = await binding.limit({ key: `global-request:burst:${key}` });
      return success
        ? { success: true, remaining: -1, resetAt }
        : { success: false, remaining: 0, resetAt };
    } catch (err) {
      console.error("[rate-limit] burst binding failed, falling back to Upstash:", err);
    }
  }
  return rateLimit(
    `global-request:burst:${key}`,
    GLOBAL_REQUEST_LIMITS.burst.limit,
    GLOBAL_REQUEST_LIMITS.burst.windowS
  );
}

/**
 * The middleware runs on EVERY page and API request, and each Upstash round
 * trip is paid in request latency. On Cloudflare the burst window is counted
 * by the native binding above (no round trip at all); everywhere else it
 * falls back to Upstash. The coarse sustained quota's "allowed" verdict is
 * cached per worker for a couple of seconds, so a typical request costs ONE
 * Redis round trip instead of two — and none at all when the burst binding is
 * present while the sustained verdict is cached.
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
  // Burst window: strict, checked on every request (native binding on
  // Cloudflare, Upstash elsewhere — see checkBurstLimit).
  const burst = await checkBurstLimit(key);
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
