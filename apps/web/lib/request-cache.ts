import type { CachedContentEvent } from "./communities/cache/types"

type CacheEntry<T> = {
  value: T
  fetchedAt: number
}

type CacheOptions = {
  staleMs?: number
  force?: boolean
  headers?: HeadersInit
}

type CacheEvent = "hit" | "miss" | "dedup" | "revalidate" | "invalidate"

type BootstrapBackedRequest = {
  communityId: string
  isInitialRead: boolean
  section?: string
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
/**
 * In-flight reads carry the cache epoch they started under. An invalidation
 * bumps the key's epoch, so a read that began BEFORE it can no longer answer a
 * caller that asked after it — and its late response must not repopulate the
 * entry. Without this, a forced refresh issued right after a mutation (a DM
 * read, for example) could be handed the mutation's pre-state.
 */
const inFlight = new Map<string, { promise: Promise<unknown>; epoch: number }>()
const epochs = new Map<string, number>()
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
  epochs.clear()
  listeners.clear()
  activeUserId = null
}

function epochFor(key: string): number {
  return epochs.get(key) ?? 0
}

function bumpEpoch(key: string) {
  epochs.set(key, epochFor(key) + 1)
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
    section,
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
    // Full metadata must start after the critical snapshot has had a paint
    // opportunity. All callers (chat and right sidebar) share this path.
    if (!bootstrapBacked.section && typeof requestAnimationFrame === "function") {
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      // Another consumer may have completed the shared read during that paint.
      cached = entries.get(key) as CacheEntry<T> | undefined
      if (cached && Date.now() - cached.fetchedAt < staleMs) return cached.value
    }
  }

  const requestEpoch = epochFor(key)
  const pending = inFlight.get(key)
  if (pending && pending.epoch === requestEpoch) {
    log("dedup", key)
    return pending.promise as Promise<T>
  }

  if (!loggedLookup) log(cached ? "revalidate" : "miss", key)
  const request = fetch(url, { cache: "no-store", headers: options.headers })
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
      // A successful status can still carry an empty or non-JSON body (for
      // example, an upstream HTML page). Never cache that as usable data.
      if (body === null) {
        throw new Error("The server returned an invalid response. Please try again.")
      }
      // An invalidation landed while this read was in flight: the caller may
      // still use the body, but it must not become the cached snapshot.
      if (epochFor(key) === requestEpoch) {
        entries.delete(key)
        entries.set(key, { value: body as T, fetchedAt: Date.now() })
        while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!)
        listeners.get(key)?.forEach((listener) => listener())
      }
      return body as T
    })
    .finally(() => {
      if (inFlight.get(key)?.promise === request) inFlight.delete(key)
    })

  inFlight.set(key, { promise: request, epoch: requestEpoch })
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
  // Supersede any read already in flight for this key: it started before the
  // mutation this invalidation reports, so its response cannot be reused.
  bumpEpoch(key)
  log("invalidate", key)
  listeners.get(key)?.forEach((listener) => listener())
}

export function invalidateRequestPrefix(prefix: string, userId = activeUserId ?? "anonymous") {
  const canonicalPrefix = canonicalRequestKey(prefix, userId)
  const keys = new Set([...entries.keys(), ...inFlight.keys()])
  for (const key of keys) {
    if (key.startsWith(canonicalPrefix)) {
      entries.delete(key)
      bumpEpoch(key)
      log("invalidate", key)
      listeners.get(key)?.forEach((listener) => listener())
    }
  }
}

export type CommunityBootstrap = {
  community: unknown
  messages: unknown
  permissions?: unknown
  unreadCount: number
  /** Permanent "John created a …" chat cards for threads/showcase/resources/events. */
  "content-events"?: { events?: CachedContentEvent[] }
  /** Local mutations that must win over history still in flight. */
  contentEventChanges?: Record<string, CachedContentEvent | null>
  contentEventsLoaded?: boolean
  threads?: unknown
  events?: unknown
  resources?: unknown
  showcase?: unknown
  members?: unknown
  rules?: unknown
  failures?: Array<{ section: string; message: string }>
}

export async function fetchAndHydrateCommunityBootstrap(
  communityId: string,
  userId: string,
): Promise<CommunityBootstrap> {
  const base = `/api/communities/${communityId}`
  const data = await fetchJsonCached<CommunityBootstrap>(
    `${base}/bootstrap`,
    { staleMs: COMMUNITY_BOOTSTRAP_STALE_MS, headers: { "X-Community-Bootstrap": "chat" } },
    userId,
  )
  const sections: Array<[string, unknown]> = [
    // A partial header snapshot must never satisfy a full metadata request.
    [(data.community as { community?: { details_loaded?: boolean } })?.community?.details_loaded === false
      ? `${base}/chat` : base, data.community],
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
  return data
}

/** Load timeline cards after the critical message snapshot, and keep local
 * create/delete mirrors on the same canonical bootstrap cache entry. */
export async function fetchAndHydrateCommunityContentEvents(communityId: string, userId: string) {
  const base = `/api/communities/${communityId}`
  const bootstrap = await fetchAndHydrateCommunityBootstrap(communityId, userId)
  const cached = bootstrap.contentEventsLoaded === false ? undefined : bootstrap["content-events"]
  const section = cached ?? (await fetchJsonCached<CommunityBootstrap>(
    `${base}/bootstrap?section=content-events`,
    // A missing section means the canonical bootstrap was never completed or
    // was invalidated by a mutation. Do not replay an older secondary snapshot.
    { force: true },
    userId,
  ))["content-events"]
  if (!section) throw new Error("Community timeline unavailable")
  let hydrated = section
  patchCachedRequest<CommunityBootstrap>(`${base}/bootstrap`, (current) => {
    const events = new Map((section.events ?? []).map((event) => [event.id, event]))
    for (const [id, change] of Object.entries(current.contentEventChanges ?? {})) {
      if (change === null) events.delete(id)
      else events.set(id, change)
    }
    hydrated = { ...section, events: [...events.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)) }
    return { ...current, "content-events": hydrated, contentEventsLoaded: true }
  }, userId)
  setCachedRequest(`${base}/content-events`, hydrated, userId)
  return hydrated
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
