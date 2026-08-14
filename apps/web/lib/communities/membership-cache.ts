export type MembershipCacheStatus = "hit" | "miss" | "dedup"

type CacheEntry = {
  isMember: boolean
  expiresAt: number
}

const DEFAULT_TTL_MS = 5 * 60_000
const MAX_ENTRIES = 2_000
const entries = new Map<string, CacheEntry>()
const inFlight = new Map<string, Promise<boolean>>()

function cacheKey(communityId: string, userId: string) {
  return `${communityId}:${userId}`
}

function setEntry(key: string, isMember: boolean, ttlMs: number) {
  entries.delete(key)
  entries.set(key, { isMember, expiresAt: Date.now() + ttlMs })
  while (entries.size > MAX_ENTRIES) {
    entries.delete(entries.keys().next().value!)
  }
}

export async function getMembershipCached(
  communityId: string,
  userId: string,
  load: () => Promise<boolean>,
  options: { ttlMs?: number; now?: number } = {},
): Promise<{ isMember: boolean; status: MembershipCacheStatus }> {
  const key = cacheKey(communityId, userId)
  const now = options.now ?? Date.now()
  const cached = entries.get(key)

  if (cached && cached.expiresAt > now) {
    return { isMember: cached.isMember, status: "hit" }
  }
  if (cached) entries.delete(key)

  const pending = inFlight.get(key)
  if (pending) {
    return { isMember: await pending, status: "dedup" }
  }

  const request = load()
    .then((isMember) => {
      setEntry(key, isMember, options.ttlMs ?? DEFAULT_TTL_MS)
      return isMember
    })
    .finally(() => inFlight.delete(key))

  inFlight.set(key, request)
  return { isMember: await request, status: "miss" }
}

export function invalidateMembership(communityId: string, userId: string) {
  const key = cacheKey(communityId, userId)
  entries.delete(key)
  inFlight.delete(key)
}

export function clearMembershipCache() {
  entries.clear()
  inFlight.clear()
}
