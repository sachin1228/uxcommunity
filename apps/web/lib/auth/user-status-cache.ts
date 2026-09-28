export type UserStatus = { exists: boolean; is_blocked: boolean }

type StatusEntry = {
  value: UserStatus
  expiresAt: number
}

const DEFAULT_TTL_MS = 15_000
/**
 * Hard cap on live entries. The cache is keyed per user and an isolate can see
 * many distinct users before it recycles, so without a bound a busy isolate
 * accumulated one entry per user that ever hit a guarded route.
 */
const DEFAULT_MAX_ENTRIES = 1_000

const entries = new Map<string, StatusEntry>()
const inFlight = new Map<string, Promise<UserStatus>>()

export async function getUserStatusCached(
  userId: string,
  load: () => Promise<UserStatus>,
  options: { ttlMs?: number; now?: number; maxEntries?: number } = {},
): Promise<UserStatus> {
  const now = options.now ?? Date.now()
  const cached = entries.get(userId)
  if (cached && cached.expiresAt > now) {
    // Refresh LRU position so an actively checked user is not evicted by a scan.
    entries.delete(userId)
    entries.set(userId, cached)
    return cached.value
  }
  if (cached) entries.delete(userId)

  const pending = inFlight.get(userId)
  if (pending) return pending

  const request = load()
    .then((value) => {
      setEntry(
        userId,
        { value, expiresAt: Date.now() + (options.ttlMs ?? DEFAULT_TTL_MS) },
        options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      )
      return value
    })
    .finally(() => inFlight.delete(userId))

  inFlight.set(userId, request)
  return request
}

/** Insert one entry, pruning expired rows and evicting the oldest past the cap. */
function setEntry(userId: string, entry: StatusEntry, maxEntries: number): void {
  entries.delete(userId)
  entries.set(userId, entry)

  if (entries.size > maxEntries) {
    const cutoff = Date.now()
    for (const [key, value] of entries) {
      if (entries.size <= maxEntries) break
      if (value.expiresAt <= cutoff) entries.delete(key)
    }
  }
  while (entries.size > maxEntries) {
    const oldest = entries.keys().next().value
    if (oldest === undefined) break
    entries.delete(oldest)
  }
}

export function invalidateUserStatus(userId: string) {
  entries.delete(userId)
}

export function clearUserStatusCache() {
  entries.clear()
  inFlight.clear()
}

/** Live entry count — exposed for tests and bounded-growth assertions. */
export function userStatusCacheSize(): number {
  return entries.size
}
