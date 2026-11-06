/**
 * Server-side connection limits for one community room.
 *
 * The client already caps the sockets it keeps open, but a client is not a
 * security boundary: one authenticated member can open an arbitrary number of
 * WebSockets to a room. These limits live in the Room Durable Object, where
 * they are enforced after hibernation reconstruction and therefore cannot be
 * bypassed by reconnecting.
 *
 * Policy: the OLDEST matching socket is evicted, not the newest rejected.
 * A reconnect/reload is the common case (a stale socket may not have closed
 * yet), and refusing the new socket would leave the member offline while the
 * stale one lingers. Eviction is safe because the socket is closed with a
 * dedicated code and the client reconnects.
 */

export const DEFAULT_MAX_SOCKETS_PER_USER = 12;
export const DEFAULT_MAX_SOCKETS_PER_SESSION = 8;
export const DEFAULT_UPGRADE_BURST = 30;
export const DEFAULT_UPGRADE_REFILL_PER_SECOND = 5;

/** Read a positive integer setting, clamped to a conservative range. */
export function readSocketLimit(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

export interface SocketIdentity {
  /** The session id in the socket's hibernation attachment. */
  sid: string;
}

export interface SocketLimitPolicy {
  perUser: number;
  perSession: number;
}

/**
 * Indices (into `existing`, oldest first) to evict before accepting a socket
 * for `incomingSid`. The session cap runs first so a single tab cannot consume
 * the whole user budget; the user cap then removes the oldest remaining
 * sockets, including other devices' sockets if the member really is at the
 * user limit. The returned list is sorted oldest-first.
 */
export function chooseSocketEvictions(
  existing: readonly SocketIdentity[],
  incomingSid: string,
  policy: SocketLimitPolicy,
): number[] {
  const userLimit = Math.max(1, policy.perUser);
  const sessionLimit = Math.max(1, Math.min(policy.perSession, userLimit));

  const evicted = new Set<number>();
  let userCount = existing.length;
  let sessionCount = existing.filter((socket) => socket.sid === incomingSid).length;

  for (let index = 0; index < existing.length; index += 1) {
    if (sessionCount < sessionLimit) break;
    if (existing[index].sid !== incomingSid || evicted.has(index)) continue;
    evicted.add(index);
    sessionCount -= 1;
    userCount -= 1;
  }

  for (let index = 0; index < existing.length; index += 1) {
    if (userCount < userLimit) break;
    if (evicted.has(index)) continue;
    evicted.add(index);
    userCount -= 1;
    if (existing[index].sid === incomingSid) sessionCount -= 1;
  }

  return [...evicted].sort((a, b) => a - b);
}
