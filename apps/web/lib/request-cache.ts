import type { CachedContentEvent } from "@/lib/communities/cache"

type CacheEntry<T> = {
  value: T
  fetchedAt: number
}

type CacheOptions = {
  staleMs?: number
  force?: boolean
}

type CacheEvent = "hit" | "miss" | "dedup" | "revalidate" | "invalidate"

type BootstrapBackedRequest = {
  communityId: string
  isInitialRead: boolean
}

const DEFAULT_STALE_MS = 60_000
/**
 * Community bootstrap data (read model + first message page) is cached for 15
 * minutes so revisiting a community renders instantly from cache. Realtime
 * keeps the chat current while viewing, and useRealtimeChat runs an
 * incremental ?after= catch-up on every fresh subscription, so messages sent
 * while the user was away are still picked up.
 */
export const COMMUNITY_BOOTSTRAP_STALE_MS = 15 * 60_000
export const DASHBOARD_STALE_MS = {
  communities: 60_000,
  homeFeed: 60_000,
  notifications: 30_000,
} as const
const MAX_ENTRIES = 100
const entries = new Map<string, CacheEntry<unknown>>()
const inFlight = new Map<string, Promise<unknown>>()
const listeners = new Map<string, Set<() => void>>()
let activeUserId: string | null = null
const cacheTelemetry: Record<CacheEvent, number> = {
  hit: 0,
  miss: 0,
  dedup: 0,
  revalidate: 0,
  invalidate: 0,
}

export function getRequestCacheTelemetry() {
  const requests = cacheTelemetry.hit + cacheTelemetry.miss + cacheTelemetry.revalidate
  return {
    ...cacheTelemetry,
    requests,
    hit_rate: requests ? Math.round((cacheTelemetry.hit / requests) * 10_000) / 100 : 0,
  }
}

function log(event: CacheEvent, key: string) {
  cacheTelemetry[event] += 1
}

export function canonicalRequestKey(url: string, userId = activeUserId ?? "anonymous") {
  const parsed = new URL(url, "http://uxcommunity.local")
  parsed.searchParams.sort()
  return `${userId}:${parsed.pathname}${parsed.search}`
}

export function staleTimeForRequest(url: string) {
  const pathname = new URL(url, "http://uxcommunity.local").pathname
  if (pathname === "/api/communities") return DASHBOARD_STALE_MS.communities
  if (pathname === "/api/home/feed") return DASHBOARD_STALE_MS.homeFeed
  if (pathname === "/api/notifications") return DASHBOARD_STALE_MS.notifications
  return DEFAULT_STALE_MS
}

export function initRequestCache(userId: string) {
  if (activeUserId && activeUserId !== userId) clearRequestCache()
  activeUserId = userId
}

export function clearRequestCache() {
  entries.clear()
  inFlight.clear()
  listeners.clear()
  activeUserId = null
}

export function getCachedRequest<T>(url: string, userId?: string): T | undefined {
  return entries.get(canonicalRequestKey(url, userId))?.value as T | undefined
}

function getBootstrapBackedRequest(url: string): BootstrapBackedRequest | null {
  const parsed = new URL(url, "http://uxcommunity.local")
  const match = parsed.pathname.match(
    /^\/api\/communities\/([^/]+)(?:\/(messages|permissions|unread|showcase|threads|events|resources|members|rules))?$/,
  )
  if (!match) return null

  const section = match[2]
  const hasPaginationOrSearch = ["before", "after", "cursor", "search", "q"].some(
    (parameter) => parsed.searchParams.has(parameter),
  )
  const isPageZeroMembers = section !== "members"
    || parsed.searchParams.size === 0
    || (parsed.searchParams.size === 1 && parsed.searchParams.get("page") === "0")

  return {
    communityId: match[1],
    isInitialRead: !hasPaginationOrSearch && isPageZeroMembers,
  }
}

export async function fetchJsonCached<T>(
  url: string,
  options: CacheOptions = {},
  userId?: string,
): Promise<T> {
  const key = canonicalRequestKey(url, userId)
  const staleMs = options.staleMs ?? staleTimeForRequest(url)
  let cached = entries.get(key) as CacheEntry<T> | undefined
  let fresh = cached && Date.now() - cached.fetchedAt < staleMs

  if (!options.force && fresh && cached) {
    log("hit", key)
    return cached.value
  }

  const bootstrapBacked = getBootstrapBackedRequest(url)
  let loggedLookup = false
  if (!options.force && bootstrapBacked?.isInitialRead) {
    log(cached ? "revalidate" : "miss", key)
    loggedLookup = true
    await fetchAndHydrateCommunityBootstrap(
      bootstrapBacked.communityId,
      userId ?? activeUserId ?? "anonymous",
    )
    cached = entries.get(key) as CacheEntry<T> | undefined
    fresh = cached && Date.now() - cached.fetchedAt < staleMs
    if (fresh && cached) {
      log("hit", key)
      return cached.value
    }
  }

  const pending = inFlight.get(key) as Promise<T> | undefined
  if (pending) {
    log("dedup", key)
    return pending
  }

  if (!loggedLookup) log(cached ? "revalidate" : "miss", key)
  const request = fetch(url, { cache: "no-store" })
    .then(async (response) => {
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body
          ? String(body.error)
          : `Request failed (${response.status})`
        // The status rides along so callers can tell a permanent failure (400 /
        // 403) from a transient one (429 / 5xx) without parsing the message —
        // see isRetryableCatchUpError in lib/communities/messages.
        const error = new Error(message) as Error & { status?: number }
        error.status = response.status
        throw error
      }
      entries.delete(key)
      entries.set(key, { value: body as T, fetchedAt: Date.now() })
      while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!)
      listeners.get(key)?.forEach((listener) => listener())
      return body as T
    })
    .finally(() => inFlight.delete(key))

  inFlight.set(key, request)
  return request
}

export function setCachedRequest<T>(url: string, value: T, userId?: string) {
  const key = canonicalRequestKey(url, userId)
  entries.delete(key)
  entries.set(key, { value, fetchedAt: Date.now() })
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!)
  listeners.get(key)?.forEach((listener) => listener())
}

export function patchCachedRequest<T>(
  url: string,
  update: (current: T) => T,
  userId?: string,
) {
  const key = canonicalRequestKey(url, userId)
  const cached = entries.get(key) as CacheEntry<T> | undefined
  if (!cached) return
  setCachedRequest(url, update(cached.value), userId)
}

export function invalidateRequest(url: string, userId?: string) {
  const key = canonicalRequestKey(url, userId)
  entries.delete(key)
  log("invalidate", key)
  listeners.get(key)?.forEach((listener) => listener())
}

export function invalidateRequestPrefix(prefix: string, userId = activeUserId ?? "anonymous") {
  const canonicalPrefix = canonicalRequestKey(prefix, userId)
  for (const key of entries.keys()) {
    if (key.startsWith(canonicalPrefix)) {
      entries.delete(key)
      log("invalidate", key)
      listeners.get(key)?.forEach((listener) => listener())
    }
  }
}

export type CommunityBootstrap = {
  community: unknown
  messages: unknown
  permissions: unknown
  unreadCount: number
  /** Permanent "John created a …" chat cards for threads/showcase/resources/events. */
  "content-events"?: { events?: unknown[] }
  threads?: unknown
  events?: unknown
  resources?: unknown
  showcase?: unknown
  members?: unknown
  rules?: unknown
  failures?: Array<{ section: string; message: string }>
}

/**
 * The bootstrap sections that gate the chat's first paint.
 *
 * Content events (the "John created a …" timeline cards) are the slowest
 * bootstrap section — the route re-reads the community read model for it,
 * then walks its own query waves — and they are permanent history cards, not
 * first-paint data. Keeping them out of the fast request lets the read model,
 * the message page and rules hydrate a section-of-work earlier; the deferred
 * request below fills the same client caches right after, so the timeline
 * still seeds from history. The route keeps serving every section when
 * `sections` is absent, which older clients (the Expo app) rely on.
 */
export const COMMUNITY_BOOTSTRAP_FAST_SECTIONS = "community,messages,rules";

function hydrateCommunityBootstrap(
  data: CommunityBootstrap,
  communityId: string,
  userId: string,
) {
  const base = `/api/communities/${communityId}`;
  const sections: Array<[string, unknown]> = [
    [base, data.community],
    [`${base}/messages`, data.messages],
    [`${base}/permissions`, data.permissions],
    [`${base}/unread`, { unreadCount: data.unreadCount }],
    [`${base}/content-events`, data["content-events"]],
    [`${base}/threads`, data.threads],
    [`${base}/events`, data.events],
    [`${base}/resources`, data.resources],
    [`${base}/showcase`, data.showcase],
    [`${base}/members?page=0`, data.members],
    [`${base}/rules`, data.rules],
  ]
  for (const [url, value] of sections) {
    if (value !== undefined) setCachedRequest(url, value, userId)
  }
}

export async function fetchAndHydrateCommunityBootstrap(
  communityId: string,
  userId: string,
): Promise<CommunityBootstrap> {
  const base = `/api/communities/${communityId}`
  const data = await fetchJsonCached<CommunityBootstrap>(
    `${base}/bootstrap?sections=${COMMUNITY_BOOTSTRAP_FAST_SECTIONS}`,
    { staleMs: COMMUNITY_BOOTSTRAP_STALE_MS },
    userId,
  )
  hydrateCommunityBootstrap(data, communityId, userId)
  // Fire-and-forget. Whoever renders the content-event cards awaits
  // fetchDeferredCommunityContentEvents — the dedupe in fetchJsonCached makes
  // that the same request, settled once.
  void fetchDeferredCommunityContentEvents(communityId, userId).catch(() => {})
  return data
}

/**
 * The slow bootstrap section, fetched off the first-paint path: the route
 * runs only the content-events producer (`sections=content-events`), and the
 * result lands on the same per-section cache entry the timeline reads plus
 * the fast bootstrap entry, so a later rehydration of the community sees it.
 * Same 15-minute window as the rest of the bootstrap: realtime keeps the
 * cards current once the community is open.
 */
export async function fetchDeferredCommunityContentEvents(
  communityId: string,
  userId: string,
): Promise<CachedContentEvent[] | undefined> {
  const base = `/api/communities/${communityId}`
  const data = await fetchJsonCached<{ "content-events"?: { events?: CachedContentEvent[] } }>(
    `${base}/bootstrap?sections=content-events`,
    { staleMs: COMMUNITY_BOOTSTRAP_STALE_MS },
    userId,
  )
  const events = data?.["content-events"]?.events
  if (events) {
    setCachedRequest(`${base}/content-events`, { events }, userId)
    patchCachedRequest<CommunityBootstrap>(
      `${base}/bootstrap?sections=${COMMUNITY_BOOTSTRAP_FAST_SECTIONS}`,
      (current) => ({ ...current, "content-events": { events } }),
      userId,
    )
  }
  return events
}

/**
 * Drop every client copy of a community's bootstrap data — the fast entry,
 * the deferred content-events entry, and the legacy plain URL. Used when a
 * server-side fact the read model carries changes outside the community's own
 * flows (e.g. an event deletion rewrites the room's date fields).
 */
export function invalidateCommunityBootstrapCache(communityId: string, userId?: string) {
  const base = `/api/communities/${communityId}`
  invalidateRequest(`${base}/bootstrap`, userId)
  invalidateRequest(`${base}/bootstrap?sections=${COMMUNITY_BOOTSTRAP_FAST_SECTIONS}`, userId)
  invalidateRequest(`${base}/bootstrap?sections=content-events`, userId)
  invalidateRequest(`${base}/content-events`, userId)
}

export function subscribeToRequest(url: string, listener: () => void, userId?: string) {
  const key = canonicalRequestKey(url, userId)
  const subscribers = listeners.get(key) ?? new Set<() => void>()
  subscribers.add(listener)
  listeners.set(key, subscribers)
  return () => {
    subscribers.delete(listener)
    if (!subscribers.size) listeners.delete(key)
  }
}
