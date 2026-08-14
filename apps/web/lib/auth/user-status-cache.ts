export type UserStatus = { exists: boolean; is_blocked: boolean }
export type UserStatusCacheState = "hit" | "miss" | "dedup"

type StatusEntry = {
  value: UserStatus
  expiresAt: number
}

const DEFAULT_TTL_MS = 30_000
const MAX_ENTRIES = 2_000
const entries = new Map<string, StatusEntry>()
const inFlight = new Map<string, Promise<UserStatus>>()

export async function getUserStatusCachedWithState(
  userId: string,
  load: () => Promise<UserStatus>,
  options: { ttlMs?: number; now?: number } = {},
): Promise<{ value: UserStatus; state: UserStatusCacheState }> {
  const now = options.now ?? Date.now()
  const cached = entries.get(userId)
  if (cached && cached.expiresAt > now) return { value: cached.value, state: "hit" }
  if (cached) entries.delete(userId)

  const pending = inFlight.get(userId)
  if (pending) return { value: await pending, state: "dedup" }

  const request = load()
    .then((value) => {
      entries.delete(userId)
      entries.set(userId, {
        value,
        expiresAt: Date.now() + (options.ttlMs ?? DEFAULT_TTL_MS),
      })
      while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!)
      return value
    })
    .finally(() => inFlight.delete(userId))

  inFlight.set(userId, request)
  return { value: await request, state: "miss" }
}

export async function getUserStatusCached(
  userId: string,
  load: () => Promise<UserStatus>,
  options: { ttlMs?: number; now?: number } = {},
): Promise<UserStatus> {
  return (await getUserStatusCachedWithState(userId, load, options)).value
}

export function invalidateUserStatus(userId: string) {
  entries.delete(userId)
}

export function clearUserStatusCache() {
  entries.clear()
  inFlight.clear()
}
