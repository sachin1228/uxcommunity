import {
  isCommunityRoom,
  type ConnectionState,
  type InboundFrame,
  type RealtimePresenceUser,
  type RoomState,
} from "./protocol";

/**
 * Community sockets are 1:1 with a room; if the server-supplied room is not
 * one we track, fall back to the connection's own room.
 */
export function resolveFrameRoom(
  rooms: Map<string, RoomState>,
  conn: ConnectionState,
  msg: InboundFrame,
): string | undefined {
  if (msg.room && rooms.has(msg.room)) return msg.room;
  return isCommunityRoom(conn.key) ? conn.key : msg.room;
}

export function applyPresenceDelta(
  cached: RealtimePresenceUser[],
  msg: InboundFrame,
): RealtimePresenceUser[] {
  const { joined, left } = msg;
  if (joined) return [...cached.filter((u) => u.id !== joined.id), joined];
  if (left) return cached.filter((u) => u.id !== left.id);
  return cached;
}

/**
 * Every (room, topic) a freshly opened socket must re-subscribe to. A
 * community socket carries only its own room; the shared user socket carries
 * every user-scoped room.
 */
export function subscriptionsForConnection(
  rooms: Map<string, RoomState>,
  connKey: string,
): Array<{ room: string; topic: string }> {
  const out: Array<{ room: string; topic: string }> = [];
  const collect = (room: string, state: RoomState) => {
    for (const [topic, refCount] of state.topicRefs) {
      if (refCount > 0) out.push({ room, topic });
    }
  };
  const own = rooms.get(connKey);
  if (own) collect(connKey, own);
  if (!isCommunityRoom(connKey)) {
    for (const [room, state] of rooms) {
      if (!isCommunityRoom(room)) collect(room, state);
    }
  }
  return out;
}

export function isRoomIdle(state: RoomState): boolean {
  return state.subscribeRefs === 0 && state.topicRefs.size === 0 && state.presenceHandlers.size === 0;
}

/** True when some user-scoped room still needs the shared user socket. */
export function wantsUserSocket(rooms: Map<string, RoomState>): boolean {
  return [...rooms.values()].some((state) => !isCommunityRoom(state.room) && !isRoomIdle(state));
}

/**
 * When the tab becomes visible again (or the network comes back) call
 * `probeAll`. Background tabs get their timers throttled and their sockets can
 * die without firing `close`, so `readyState` lies until we ask.
 */
export function onTabResume(probeAll: () => void): void {
  const probeIfVisible = () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    probeAll();
  };
  document.addEventListener("visibilitychange", probeIfVisible);
  window.addEventListener("focus", probeIfVisible);
  window.addEventListener("online", probeIfVisible);
  window.addEventListener("pageshow", probeIfVisible);
}
