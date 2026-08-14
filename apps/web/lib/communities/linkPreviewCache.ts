/**
 * Shared client-side cache for `/api/link-preview` lookups.
 *
 * Every component that fetches link metadata (chat message bubbles, the chat
 * compose preview, resource cards, create/edit resource modals) goes through
 * this module so the same URL always shares one network request:
 *
 *   - Cache keys are normalized URLs (case, trailing slash, hash, query order).
 *   - Fresh metadata (10 min) is served from cache without a network request.
 *   - In-flight requests are deduplicated — concurrent callers receive the
 *     same promise instead of starting a second fetch.
 *   - Failed lookups are cached briefly (60 s) so broken URLs don't spam the
 *     upstream fetcher.
 *
 * The API response format is untouched: the original URL is sent to the
 * server, so `data.url` in the response matches exactly what the user
 * provided, keeping existing UI behavior unchanged.
 */
import type { LinkPreviewData } from "./linkPreview";

/** Fresh link-preview metadata is served from cache for 10 minutes. */
export const LINK_PREVIEW_STALE_MS = 10 * 60 * 1000;

/** Failed lookups are suppressed for 60 seconds before being retried. */
export const LINK_PREVIEW_FAILURE_RETRY_MS = 60 * 1000;

/** Cap cache size to avoid unbounded growth. */
const LINK_PREVIEW_CACHE_MAX = 500;

type LinkPreviewCacheStatus = "ok" | "error";

interface LinkPreviewCacheEntry {
  data: LinkPreviewData | null;
  fetchedAt: number;
  status: LinkPreviewCacheStatus;
}

export type LinkPreviewSource = "cache" | "in-flight" | "network" | "error";

export interface LinkPreviewResult {
  data: LinkPreviewData | null;
  source: LinkPreviewSource;
  /** True when the data comes from a request another component already started. */
  fromExistingRequest: boolean;
}

// url (normalized) → entry
const cache = new Map<string, LinkPreviewCacheEntry>();
// url (normalized) → in-flight promise shared by all callers
const inFlight = new Map<string, Promise<LinkPreviewData | null>>();

/**
 * Normalize a URL for cache-keying so equivalent forms (case, trailing slash,
 * fragment, query-parameter order) share one request.
 */
export function normalizePreviewUrl(raw: string): string {
  const trimmed = raw.trim();
  try {
    const url = new URL(trimmed);
    // Fragments aren't sent to the server and don't change the page metadata.
    url.hash = "";
    // Parameter order shouldn't cause separate requests.
    url.searchParams.sort();
    // Drop default ports.
    if (
      (url.protocol === "http:" && url.port === "80") ||
      (url.protocol === "https:" && url.port === "443")
    ) {
      url.port = "";
    }
    // Trailing slash on the path is equivalent for metadata purposes.
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return trimmed;
  }
}

/** Development-only logs in the requested `[LINK PREVIEW …]` format. */
function devLog(tag: "LINK PREVIEW CACHE" | "LINK PREVIEW NETWORK", fields: Record<string, string>) {
  if (process.env.NODE_ENV !== "development") return;
  console.debug(`\n[${tag}]`);
  for (const [key, value] of Object.entries(fields)) console.debug(`${key}: ${value}`);
}

function trimCache() {
  while (cache.size > LINK_PREVIEW_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

async function fetchPreviewFromNetwork(
  key: string,
  requestUrl: string,
): Promise<LinkPreviewData | null> {
  try {
    const response = await fetch(`/api/link-preview?url=${encodeURIComponent(requestUrl)}`);
    if (!response.ok) throw new Error(`Link preview failed (${response.status})`);
    const data = (await response.json()) as LinkPreviewData;
    cache.set(key, { data, fetchedAt: Date.now(), status: "ok" });
    trimCache();
    return data;
  } catch {
    cache.set(key, { data: null, fetchedAt: Date.now(), status: "error" });
    trimCache();
    return null;
  }
}

/**
 * Fetch link-preview metadata for a URL, sharing the request across all
 * callers. Resolves with `null` when the upstream fetch fails (the failure is
 * remembered for 60 seconds so the URL isn't hammered repeatedly).
 */
export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreviewResult> {
  const key = normalizePreviewUrl(rawUrl);
  const requestUrl = rawUrl.trim();
  const now = Date.now();
  const entry = cache.get(key);

  // Fresh metadata — serve from cache, no network.
  if (entry && entry.status === "ok" && now - entry.fetchedAt < LINK_PREVIEW_STALE_MS) {
    devLog("LINK PREVIEW CACHE", {
      url: key,
      source: "cache",
      age: `${Math.max(0, Math.round((now - entry.fetchedAt) / 1000))}s`,
    });
    return { data: entry.data, source: "cache", fromExistingRequest: false };
  }

  // Recently failed — don't retry inside the failure window.
  if (entry && entry.status === "error" && now - entry.fetchedAt < LINK_PREVIEW_FAILURE_RETRY_MS) {
    devLog("LINK PREVIEW CACHE", {
      url: key,
      source: "error",
      age: `${Math.max(0, Math.round((now - entry.fetchedAt) / 1000))}s`,
    });
    return { data: null, source: "error", fromExistingRequest: false };
  }

  // Another component is already fetching — join its request.
  const pending = inFlight.get(key);
  if (pending) {
    devLog("LINK PREVIEW CACHE", {
      url: key,
      source: "in-flight",
      note: "loading from existing request",
    });
    const data = await pending;
    return { data, source: "in-flight", fromExistingRequest: true };
  }

  devLog("LINK PREVIEW NETWORK", {
    url: key,
    reason: entry ? "stale" : "miss",
  });

  const request = fetchPreviewFromNetwork(key, requestUrl);
  inFlight.set(key, request);
  try {
    const data = await request;
    return { data, source: "network", fromExistingRequest: false };
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Synchronous cache read for initial state hydration. Returns:
 *   - `undefined` — never fetched (callers should show a loading state)
 *   - `null`      — the last lookup failed (callers should show nothing)
 *   - data        — last known metadata (may be stale; it's still better than
 *                   a blank while a background refetch runs)
 */
export function getCachedLinkPreview(rawUrl: string): LinkPreviewData | null | undefined {
  const entry = cache.get(normalizePreviewUrl(rawUrl));
  if (!entry) return undefined;
  return entry.data;
}

/** True when a fresh (≤10 min) metadata entry exists — skip the fetch. */
export function hasFreshLinkPreview(rawUrl: string): boolean {
  const entry = cache.get(normalizePreviewUrl(rawUrl));
  return (
    !!entry &&
    entry.status === "ok" &&
    Date.now() - entry.fetchedAt < LINK_PREVIEW_STALE_MS
  );
}

/** True when a request for this URL is currently in flight (not yet resolved). */
export function isLinkPreviewLoading(rawUrl: string): boolean {
  return inFlight.has(normalizePreviewUrl(rawUrl));
}

/** Test hook — clears all cached entries and in-flight requests. */
export function clearLinkPreviewCache() {
  cache.clear();
  inFlight.clear();
}
