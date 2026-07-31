/**
 * CORS utility for the Next.js API layer.
 *
 * Allowed origins are controlled by the CORS_ALLOWED_ORIGINS environment
 * variable (comma-separated list). Two localhost origins are always included
 * so local Expo development works without any extra config.
 *
 * Usage: imported only by middleware.ts — not needed in individual route files.
 */

const DEFAULT_ORIGINS = [
  "http://localhost:8081", // Expo Web dev server
  "http://localhost:3000", // Next.js local dev
];

/**
 * Build the full allowlist from env + defaults.
 * CORS_ALLOWED_ORIGINS="https://myapp.com,https://staging.myapp.com"
 */
function buildAllowlist(): Set<string> {
  const env = process.env.CORS_ALLOWED_ORIGINS ?? "";
  const fromEnv = env
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...fromEnv]);
}

// Evaluated once at cold-start; stable for the lifetime of the edge function.
const ALLOWLIST = buildAllowlist();

const ALLOWED_METHODS = "GET, POST, PUT, PATCH, DELETE, OPTIONS";
const ALLOWED_HEADERS =
  "Content-Type, Accept, Authorization, Cookie, X-Requested-With";

/**
 * Return the CORS headers for a given request origin, or null if the origin
 * is not in the allowlist (meaning no CORS headers should be added).
 */
export function getCorsHeaders(
  origin: string | null
): Record<string, string> | null {
  if (!origin || !ALLOWLIST.has(origin)) return null;

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": ALLOWED_METHODS,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    // Required when the client sends cookies / Authorization headers
    "Access-Control-Allow-Credentials": "true",
    // Cache preflight for 1 hour
    "Access-Control-Max-Age": "3600",
    // Vary so CDN/proxies cache per-origin
    Vary: "Origin",
  };
}
