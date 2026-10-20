/**
 * Room → Durable Object routing.
 *
 * Kept dependency-free (no `cloudflare:workers` import) so the routing contract
 * can be unit-tested directly. `apps/realtime/src/index.ts` is the only caller.
 *
 * WHY THIS EXISTS — the bug this prevents:
 *   A browser opens ONE socket per community (community-scoped rooms) and ONE
 *   socket per user (user-scoped rooms), and that user socket is keyed
 *   `user:${userId}` (see `apps/web/lib/realtime/client.ts`).
 *
 *   User-scoped rooms are addressed by a LOGICAL name (`notifications:${uuid}`)
 *   that identifies the subscription, not the DO instance. Routing a logical
 *   name straight into `idFromName()` sends the event to a Durable Object that
 *   no socket ever connected to, so delivery silently no-ops and the caller
 *   still gets "ok". User-scoped publishes must instead target the recipient's
 *   `user:${userId}` instance while carrying the logical room name in the event
 *   body for subscription filtering.
 *
 *   The same rule applies in reverse to the WebSocket upgrade path: the client
 *   connects with `room=user:${userId}` (already resolved) so the upgrade goes
 *   to that user's instance, and then multiplexes its logical rooms over it.
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
 *
 * `dm:` is the direct-messages stream: ONE logical room per user
 * (`dm:${userId}`) carrying every conversation's events. All DM traffic
 * multiplexes over the user socket that already exists for notifications — no
 * per-conversation socket and no per-conversation Durable Object, so a user
 * with 500 conversations costs exactly the same as a user with one.
 */
export const USER_ROOM_PREFIXES = ["notifications:", "profile:", "dm:"] as const;

/**
 * Whether the authenticated user may open `room` over a WebSocket.
 *
 * Community rooms are authorized inside their Durable Object (membership
 * check); user-scoped rooms have no such check on the DO side — the namespace
 * instance IS the authorization boundary, and that only holds if the room
 * name is forced to the caller's own instance. Without this, any authenticated
 * socket could connect with `room=user:<victim>` (or `notifications:<victim>`,
 * `dm:<victim>`) and read another member's private stream.
 *
 * Keep it in sync with USER_ROOM_PREFIXES and the client's socket keying.
 */
export function isUserScopedRoomAllowed(room: string, userId: string): boolean {
  // An already-resolved user instance (`user:${userId}`).
  if (room.startsWith("user:")) {
    return room === `user:${userId}`;
  }
  for (const prefix of USER_ROOM_PREFIXES) {
    if (room.startsWith(prefix)) {
      return room === `${prefix}${userId}`;
    }
  }
  // Community-scoped rooms carry their own authorization.
  return true;
}

/**
 * The community a room belongs to.
 *
 * Most community rooms are `prefix:<communityId>`. Showcase rooms are the
 * exception: they carry both the community and the post, because a post id
 * alone is not a membership subject. Parsing the community from
 * `showcase:<communityId>:<postId>` is what lets the Room DO authorize the
 * socket against the real community instead of a post id.
 *
 * Legacy `showcase:<postId>` names (a pre-fix client or an in-flight publish)
 * have no community segment; they fall back to the old value and therefore
 * fail the membership check closed rather than authorizing against a post.
 */
export function communityIdFromRoomName(room: string): string {
  if (room.startsWith("showcase:")) {
    const rest = room.slice("showcase:".length);
    const separator = rest.indexOf(":");
    return separator >= 0 ? rest.slice(0, separator) : rest;
  }
  const separator = room.indexOf(":");
  return separator >= 0 ? room.slice(separator + 1) : room;
}

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
