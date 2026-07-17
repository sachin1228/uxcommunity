/**
 * Simple in-memory rate limiter.
 * Resets on server restart and does not span multiple instances.
 * For production scale, replace the store with Redis (e.g. Upstash).
 */

interface Entry {
  count: number;
  resetAt: number;
}

const store = new Map<string, Entry>();

// Prune expired entries every minute to prevent memory leaks.
const pruneInterval =
  typeof setInterval !== "undefined"
    ? setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of store) {
          if (entry.resetAt < now) store.delete(key);
        }
      }, 60_000)
    : undefined;

if (pruneInterval && typeof pruneInterval === "object") {
  // Allow Node.js to exit even if this is running.
  (pruneInterval as ReturnType<typeof setInterval>).unref?.();
}

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  resetAt: number;
}

/**
 * @param key      Unique identifier (e.g. IP + route).
 * @param limit    Max requests allowed in the window.
 * @param windowS  Window duration in seconds.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowS: number
): RateLimitResult {
  const now = Date.now();
  const windowMs = windowS * 1000;

  let entry = store.get(key);
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + windowMs };
    store.set(key, entry);
  }

  entry.count += 1;
  return {
    success: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
  };
}
