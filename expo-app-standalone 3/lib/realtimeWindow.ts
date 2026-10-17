/**
 * Mobile socket budget — how many communities may hold a live WebSocket.
 *
 * WHY A WINDOW AND NOT ONE SHARED SOCKET
 *
 * The obvious design is one socket per device carrying every community as a
 * subscription. The current server cannot serve that safely, so this module
 * bounds the socket count instead of pretending to multiplex (see
 * `docs/mobile-architecture.md` for the full trace):
 *
 *   - A WebSocket terminates in exactly one Durable Object, and the DO instance
 *     name IS the room identity: `Room.roomName()` stamps every event and
 *     presence snapshot with it, and the membership check derives the community
 *     from it (`apps/realtime/src/room.ts`).
 *   - Inside a Room DO the subscription index is keyed by TOPIC alone
 *     (`apps/realtime/src/subscriptions.ts`), which is only unambiguous because
 *     one instance serves one logical room. Two communities in one instance
 *     would collide on `message`/`like`/`save`, and presence would merge their
 *     rosters.
 *   - Routing community events to per-user DOs instead (a `user:${userId}`
 *     gateway) turns one publish into one DO request PER ONLINE RECIPIENT
 *     instead of one request plus local `ws.send()`s — a fan-out cost the
 *     realtime worker was specifically hardened to avoid.
 *
 * The surface-by-surface map — who hibernates, what moves them, at what
 * cadence — lives in `docs/community-hibernation.md`.
 *
 * So the socket count is bounded by keeping a live socket only for the
 * communities that earn one: the most recently active window. A socket is not
 * free on a phone — a heartbeat every 25 s, a reconnect on every network change,
 * server-side presence work, and memory the OS may reclaim — and before this a
 * member of 30 communities carried 30 of them.
 *
 * The community the user actually opens never depends on the window: the chat
 * screen subscribes its own room (`useChatMessages`), and everything past the
 * window still updates through the reconcile that already runs on foreground, on
 * reconnect and on pull-to-refresh.
 */

/**
 * How many communities keep a live socket, most recently active first.
 *
 * The web sidebar applies the same policy with its own, higher limit
 * (`SIDEBAR_REALTIME_LIMIT`); mobile keeps fewer because the radio and the
 * battery are the scarce resources here. Ten sockets is ~one heartbeat frame
 * every 2.5 s and at most ten reconnect attempts per network change, which is
 * the budget the app is willing to spend on background badges.
 */
export const COMMUNITY_REALTIME_LIMIT = 10;

/**
 * How often the focused community list re-reads the server when it holds
 * communities past the live window.
 *
 * Hibernated rows have no socket, so they only move when a reconcile runs —
 * and a list that is merely being looked at produces none of the triggers
 * otherwise available (foreground, reconnect, pull-to-refresh). This is the
 * slow beat for that case, the mobile counterpart of the web sidebar's poll
 * (`SIDEBAR_STALE_MS`, also 60 s, applied while it is over its window). The
 * screen runs it only while the list is focused and the app foregrounded, and
 * each tick collapses into the same debounced, single-flight reconcile as
 * every other trigger (`useCommunities`).
 */
export const HIBERNATED_LIST_REFRESH_MS = 60_000;

/**
 * The communities that keep a live socket.
 *
 * `communityIds` is the caller's list order, which the community list already
 * sorts by last activity, so the window is "the ones most likely to change
 * next". Duplicates and empty ids are dropped rather than counted twice, and the
 * result never exceeds `limit` — a 100-community member gets the same number of
 * sockets as a 10-community member.
 */
export function selectLiveCommunityIds(
  communityIds: readonly string[],
  limit: number = COMMUNITY_REALTIME_LIMIT,
): string[] {
  if (limit <= 0) return [];

  const seen = new Set<string>();
  const live: string[] = [];
  for (const id of communityIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    live.push(id);
    if (live.length === limit) break;
  }
  return live;
}
