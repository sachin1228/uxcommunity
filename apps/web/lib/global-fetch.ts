/**
 * Application-wide fetch interception.
 *
 * Patches `window.fetch` once so EVERY same-origin `/api/*` request goes
 * through the dedupe pipeline automatically — no per-component opt-in needed.
 * This covers the ~100 raw `fetch()` call sites scattered across the app with
 * a single install in the root layout:
 *
 *   - GET/HEAD: concurrent identical requests coalesce into one network call;
 *     results replay for 750 ms (dedupeFetch's default settle window).
 *   - Mutations (POST/PATCH/PUT/DELETE): a burst of identical calls collapses
 *     to one request for `MUTATION_COOLDOWN_MS` (2 s). Toggle endpoints
 *     (like/save/rsvp/join/...) additionally collapse alternating bodies via
 *     url-mode, so a like button mashed 20 times sends one request.
 *
 * Safety valves (everything here is conservative):
 *   - Only same-origin `/api/*` URLs are guarded. Cross-origin traffic,
 *     Next.js RSC navigations and `/_next/*` requests pass straight through.
 *   - `cache: "no-store"` bypasses the guard — existing call sites use it to
 *     force freshness (e.g. request-cache's internal fetch).
 *   - A request header `x-ux-dedupe-bypass: 1` opts a specific call out.
 *   - Non-string bodies (FormData, Blob, streams) bypass (uploads never
 *     collide), matching dedupeFetch's own behavior.
 *
 * The module self-installs on the client at import time (before React effects
 * run), so even the first wave of data fetches is covered.
 */
import {
  dedupeFetch,
  getDedupeFetchTelemetry,
  resetDedupeFetchImpl,
  setDedupeFetchImpl,
  type DedupeFetchOptions,
} from "./dedupe-fetch"

export const MUTATION_COOLDOWN_MS = 2000
export const DEDUPE_BYPASS_HEADER = "x-ux-dedupe-bypass"

/**
 * Toggle/idempotent endpoints whose mutations alternate bodies
 * (`saved:true` → `saved:false`) or are safe to collapse by URL alone.
 */
const TOGGLE_PATH =
  /\/(like|unlike|save|unsave|bookmark|rsvp|join|leave|follow|unfollow|vote|accept|decline|archive|read|mark-read)(\/|$)/i

let installed = false
let cleanupFn: (() => void) | null = null

function windowOrigin(): string {
  return typeof window === "undefined"
    ? "http://uxcommunity.local"
    : window.location.origin
}

function resolveUrl(input: RequestInfo | URL): URL {
  const raw =
    typeof input === "string" ? input : input instanceof URL ? input.href : input.url
  return new URL(raw, windowOrigin())
}

/** True when this request is a same-origin call to our own `/api/*` routes. */
export function isSameOriginAppApi(input: RequestInfo | URL): boolean {
  try {
    const url = resolveUrl(input)
    return url.origin === windowOrigin() && url.pathname.startsWith("/api/")
  } catch {
    return false
  }
}

/** True when the request must skip deduplication entirely. */
export function shouldBypassGuard(init?: RequestInit): boolean {
  if (!init) return false
  if (init.cache === "no-store") return true
  const headers =
    init.headers instanceof Headers
      ? init.headers
      : init.headers
        ? new Headers(init.headers)
        : null
  if (headers?.has(DEDUPE_BYPASS_HEADER)) return true
  const body = init.body
  if (body != null && typeof body !== "string" && !(body instanceof URLSearchParams)) {
    return true
  }
  return false
}

/** dedupeFetch options chosen for a request by method + path. */
export function dedupeOptionsFor(
  input: RequestInfo | URL,
  method: string,
): DedupeFetchOptions {
  if (method === "GET" || method === "HEAD") return {}
  const pathname = resolveUrl(input).pathname
  return {
    cooldownMode: TOGGLE_PATH.test(pathname) ? "url" : "exact",
    settleWindowMs: MUTATION_COOLDOWN_MS,
    mutationCooldownMs: MUTATION_COOLDOWN_MS,
  }
}

/**
 * Replaces `window.fetch` with a guarded wrapper. Idempotent; returns a
 * cleanup that restores the original fetch.
 */
export function installGlobalFetchGuard(): () => void {
  if (typeof window === "undefined") return () => {}
  if (installed && cleanupFn) return cleanupFn
  // HMR safety: if a previous module instance already patched fetch, leave it.
  if ((window.fetch as unknown as { __uxGlobalFetchGuard?: boolean })?.__uxGlobalFetchGuard) {
    return () => {}
  }

  const original = window.fetch.bind(window)
  setDedupeFetchImpl(original)

  const guarded = ((input, init) => {
    if (!isSameOriginAppApi(input) || shouldBypassGuard(init)) {
      return original(input, init)
    }
    const method = (init?.method ?? "GET").toUpperCase()
    return dedupeFetch(input, init, dedupeOptionsFor(input, method))
  }) as typeof fetch
  ;(guarded as unknown as { __uxGlobalFetchGuard: boolean }).__uxGlobalFetchGuard = true

  window.fetch = guarded
  installed = true
  cleanupFn = () => {
    if (window.fetch === guarded) window.fetch = original
    resetDedupeFetchImpl()
    installed = false
    cleanupFn = null
  }
  return cleanupFn
}

export function getGlobalFetchGuardTelemetry() {
  return { ...getDedupeFetchTelemetry() }
}

if (typeof window !== "undefined") {
  installGlobalFetchGuard()
}
