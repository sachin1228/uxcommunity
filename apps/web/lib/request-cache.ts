type CacheEntry<T> = {
  value: T
  fetchedAt: number
}

type CacheOptions = {
  staleMs?: number
  force?: boolean
}

type CacheEvent = "hit" | "miss" | "dedup" | "revalidate" | "invalidate"

const DEFAULT_STALE_MS = 60_000
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
let telemetryEvents = 0

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
  telemetryEvents += 1

  if (process.env.NODE_ENV === "development") {
    console.debug(`[request-cache] ${event}`, key)
    return
  }

  if (process.env.NODE_ENV === "production" && telemetryEvents % 20 === 0) {
    console.info(JSON.stringify({
      event: "performance.request_cache",
      metrics: getRequestCacheTelemetry(),
    }))
  }
}

export function canonicalRequestKey(url: string, userId = activeUserId ?? "anonymous") {
  const parsed = new URL(url, "http://uxcommunity.local")
  parsed.searchParams.sort()
  return `${userId}:${parsed.pathname}${parsed.search}`
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

export async function fetchJsonCached<T>(
  url: string,
  options: CacheOptions = {},
  userId?: string,
): Promise<T> {
  const key = canonicalRequestKey(url, userId)
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS
  const cached = entries.get(key) as CacheEntry<T> | undefined
  const fresh = cached && Date.now() - cached.fetchedAt < staleMs

  // Critical first-render reads share the community bootstrap promise. Secondary
  // tabs use their own endpoint cache so they never delay or inflate bootstrap.
  const parsed = new URL(url, "http://uxcommunity.local")
  const communityMatch = parsed.pathname.match(/^\/api\/communities\/([^/]+)\/(messages|permissions|unread)$/)
  const isInitialCriticalRead = communityMatch && !parsed.searchParams.has("before") && !parsed.searchParams.has("after")
  if (!options.force && !fresh && isInitialCriticalRead) {
    await fetchAndHydrateCommunityBootstrap(communityMatch[1], userId ?? activeUserId ?? "anonymous")
    return fetchJsonCached<T>(url, options, userId)
  }

  if (!options.force && fresh) {
    log("hit", key)
    return cached.value
  }

  const pending = inFlight.get(key) as Promise<T> | undefined
  if (pending) {
    log("dedup", key)
    return pending
  }

  log(cached ? "revalidate" : "miss", key)
  const request = fetch(url, { cache: "no-store" })
    .then(async (response) => {
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body
          ? String(body.error)
          : `Request failed (${response.status})`
        throw new Error(message)
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
  threads?: unknown
  events?: unknown
  resources?: unknown
  showcase?: unknown
  members?: unknown
  rules?: unknown
  stats?: unknown
  failures?: Array<{ section: string; message: string }>
}

export async function fetchAndHydrateCommunityBootstrap(
  communityId: string,
  userId: string,
): Promise<CommunityBootstrap> {
  const base = `/api/communities/${communityId}`
  const data = await fetchJsonCached<CommunityBootstrap>(
    `${base}/bootstrap`,
    { staleMs: DEFAULT_STALE_MS },
    userId,
  )
  const sections: Array<[string, unknown]> = [
    [base, data.community],
    [`${base}/messages`, data.messages],
    [`${base}/permissions`, data.permissions],
    [`${base}/unread`, { unreadCount: data.unreadCount }],
    [`${base}/threads`, data.threads],
    [`${base}/events`, data.events],
    [`${base}/resources`, data.resources],
    [`${base}/showcase`, data.showcase],
    [`${base}/members?page=0`, data.members],
    [`${base}/rules`, data.rules],
    [`${base}/stats`, data.stats],
  ]
  for (const [url, value] of sections) {
    if (value !== undefined) setCachedRequest(url, value, userId)
  }
  return data
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
