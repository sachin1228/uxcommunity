/**
 * Room → Durable Object routing.
 *
 * Kept dependency-free (no `cloudflare:workers` import) so the routing contract
 * can be unit-tested directly. `apps/realtime/src/index.ts` is the only
 * production caller.
 *
 * WHY THIS EXISTS — the bug this prevents:
 *   A browser opens ONE socket per community (community-scoped rooms) and ONE
 *   socket per user (user-scoped rooms), and that user socket is keyed
 *   `user:${userId}` (see `apps/web/lib/realtime/client.ts`).
 *
 *   User-scoped rooms are addressed by a LOGICAL name (`notifications:${uuid}`,
 *   `profile:${uuid}`) that identifies the subscription, not the DO instance.
 *   Routing a logical name straight into `idFromName()` sends the event to a
 *   Durable Object that no socket ever connected to, so delivery silently
 *   no-ops and the caller still gets "ok". User-scoped publishes must instead
 *   target the recipient's `user:${userId}` instance while carrying the logical
 *   room name in the event body for subscription filtering.
 */

/** Shapes of the two bindings this module needs (structural — avoids importing Env). */
export interface RoomRoutingBindings {
  COMMUNITY_DO: DurableObjectNamespace;
  USER_DO: DurableObjectNamespace;
}

/**
 * Rooms owned by a single user, hosted by that user's UserDO.
 *
 * Keep in sync with the client's socket keying and with `client.ts`'s
 * `COMMUNITY_ROOM_PREFIXES`: anything that is not a community room travels over
 * the user socket, and anything the server publishes in that set must resolve
 * to a `user:${userId}` instance.
 */
export const USER_ROOM_PREFIXES = ["notifications:", "profile:"] as const;

/**
 * Resolve which Durable Object owns a logical room.
 *
 * The returned `name` is the DO instance to address; the caller must keep
 * passing the original logical `room` inside the event payload, because the DO
 * filters deliveries against subscriptions keyed by logical room name.
 */
export function resolveRoomTarget(
  bindings: RoomRoutingBindings,
  room: string,
): { namespace: DurableObjectNamespace; name: string } {
  // An already-resolved user instance (`user:${userId}`) — the same form the
  // WebSocket upgrade path uses, so publishing straight at a user's DO works.
  if (room.startsWith("user:")) {
    return { namespace: bindings.USER_DO, name: room };
  }

  for (const prefix of USER_ROOM_PREFIXES) {
    if (room.startsWith(prefix)) {
      const userId = room.slice(prefix.length);
      if (userId) {
        return { namespace: bindings.USER_DO, name: `user:${userId}` };
      }
    }
  }
  return { namespace: bindings.COMMUNITY_DO, name: room };
}
