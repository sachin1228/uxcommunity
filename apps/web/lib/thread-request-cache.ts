type ThreadResourceKind = "detail" | "comments" | "reactions"

type CacheEntry<T> = {
  value: T
  fetchedAt: number
}

type ReadOptions<T> = {
  kind: ThreadResourceKind
  userId: string
  force?: boolean
  onRevalidated?: (value: T) => void
}

export const THREAD_CACHE_TTL_MS = {
  detail: 60_000,
  comments: 30_000,
  reactions: 15_000,
} as const

const MAX_ENTRIES = 100
const entries = new Map<string, CacheEntry<unknown>>()
const inFlight = new Map<string, Promise<unknown>>()

function keyFor(url: string, userId: string) {
  const parsed = new URL(url, "http://uxcommunity.local")
  parsed.searchParams.sort()
  return `${userId}:${parsed.pathname}${parsed.search}`
}

function debugCache(url: string, source: "cache" | "ssr", ageMs: number) {
  if (process.env.NODE_ENV !== "development") return
  console.debug(`[THREAD CACHE]\n${url}\nsource: ${source}\nage: ${Math.floor(ageMs / 1000)}s`)
}

function debugNetwork(reason: "miss" | "stale" | "forced") {
  if (process.env.NODE_ENV !== "development") return
  console.debug(`[THREAD NETWORK]\nreason: ${reason}`)
}

function store<T>(key: string, value: T, fetchedAt = Date.now()) {
  entries.delete(key)
  entries.set(key, { value, fetchedAt })
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!)
}

async function request<T>(url: string, key: string, reason: "miss" | "stale" | "forced") {
  const pending = inFlight.get(key) as Promise<T> | undefined
  if (pending) return pending

  debugNetwork(reason)
  const promise = fetch(url, { cache: "no-store" })
    .then(async (response) => {
      const body = await response.json().catch(() => null)
      if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body
          ? String(body.error)
          : `Request failed (${response.status})`
        throw new Error(message)
      }
      store(key, body as T)
      return body as T
    })
    .finally(() => inFlight.delete(key))

  inFlight.set(key, promise)
  return promise
}

/** Returns fresh values immediately and stale values while one deduplicated refresh runs. */
export async function fetchThreadResource<T>(url: string, options: ReadOptions<T>): Promise<T> {
  const key = keyFor(url, options.userId)
  const cached = entries.get(key) as CacheEntry<T> | undefined
  const age = cached ? Date.now() - cached.fetchedAt : Number.POSITIVE_INFINITY
  const stale = age >= THREAD_CACHE_TTL_MS[options.kind]

  if (!options.force && cached && !stale) {
    debugCache(url, "cache", age)
    return cached.value
  }

  if (!options.force && cached) {
    debugCache(url, "cache", age)
    void request<T>(url, key, "stale")
      .then((value) => options.onRevalidated?.(value))
      .catch(() => undefined)
    return cached.value
  }

  return request<T>(url, key, options.force ? "forced" : "miss")
}

export function seedThreadResource<T>(url: string, value: T, userId: string) {
  const key = keyFor(url, userId)
  const current = entries.get(key)
  if (current) return
  store(key, value)
  debugCache(url, "ssr", 0)
}

export function getThreadResource<T>(url: string, userId: string): T | undefined {
  return entries.get(keyFor(url, userId))?.value as T | undefined
}

export function patchThreadResource<T>(
  url: string,
  userId: string,
  update: (current: T) => T,
) {
  const key = keyFor(url, userId)
  const current = entries.get(key) as CacheEntry<T> | undefined
  if (current) store(key, update(current.value))
}

export function invalidateThreadResource(url: string, userId: string) {
  entries.delete(keyFor(url, userId))
}

export function invalidateThreadResources(threadId: string, userId: string) {
  const prefix = `${userId}:`
  for (const key of entries.keys()) {
    if (key.startsWith(prefix) && key.includes(`/threads/${threadId}`)) entries.delete(key)
  }
}

export function clearThreadRequestCache() {
  entries.clear()
  inFlight.clear()
}
