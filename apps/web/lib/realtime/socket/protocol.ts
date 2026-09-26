export interface RealtimeUser {
  id: string;
  name: string | null;
  avatar: string | null;
}

export interface RealtimePresenceUser {
  id: string;
  name: string | null;
  avatar: string | null;
  connections: number;
}

export type EventHandler = (data: unknown, sender?: string) => void;
export type PresenceHandler = (users: RealtimePresenceUser[]) => void;
export type StatusHandler = (connected: boolean) => void;

/** A server → client frame, after JSON parsing. */
export interface InboundFrame {
  t?: string;
  room?: string;
  topic?: string;
  data?: unknown;
  sender?: string;
  users?: RealtimePresenceUser[];
  joined?: RealtimePresenceUser;
  left?: { id: string };
  message?: string;
  connectionId?: string;
}

export const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? "";
export const RECONNECT_BASE_MS = 1000;
export const RECONNECT_MAX_MS = 15_000;
/** How often to send a heartbeat on an idle-but-open socket. */
export const HEARTBEAT_INTERVAL_MS = 25_000;
/** How long to wait for a pong before declaring the socket dead. */
export const HEARTBEAT_TIMEOUT_MS = 6_000;
export const PING_FRAME = "ping";
export const PONG_FRAME = "pong";

/** Community-scoped room prefixes that get their own WebSocket. */
const COMMUNITY_ROOM_PREFIXES = ["chat:", "threads:", "events:", "resources:", "showcase:", "rules:", "thread-comments:", "resource-comments:"];

export function isCommunityRoom(room: string): boolean {
  return COMMUNITY_ROOM_PREFIXES.some((prefix) => room.startsWith(prefix));
}

export function buildWebSocketUrl(baseUrl: string, room: string, token?: string): string {
  if (!baseUrl) {
    return `/ws?room=${encodeURIComponent(room)}`;
  }
  const wsBase = baseUrl.replace(/^http/, "ws");
  const params = new URLSearchParams({ room });
  if (token) params.set("token", token);
  return `${wsBase}/ws?${params.toString()}`;
}

export function isSubscriptionFrame(frame: string): boolean {
  try {
    const parsed = JSON.parse(frame) as { t?: string };
    return parsed.t === "subscribe" || parsed.t === "unsubscribe";
  } catch {
    return false;
  }
}

export interface RoomState {
  room: string;
  /** Reference count per topic — incremented by on(), decremented by returned cleanup. */
  topicRefs: Map<string, number>;
  /** Actual handler sets per topic. */
  topicHandlers: Map<string, Set<EventHandler>>;
  presenceHandlers: Set<PresenceHandler>;
  /** Number of live subscribe() callers for this room. */
  subscribeRefs: number;
}

export function createRoomState(room: string): RoomState {
  return {
    room,
    topicRefs: new Map(),
    topicHandlers: new Map(),
    presenceHandlers: new Set(),
    subscribeRefs: 0,
  };
}

export interface ConnectionState {
  /** The room / key this connection is registered under in `connections`. */
  key: string;
  ws: WebSocket | null;
  connected: boolean;
  manuallyClosed: boolean;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  pongTimer: ReturnType<typeof setTimeout> | null;
  pending: string[];
  user: RealtimeUser | null;
}

export function createConnectionState(key: string, user: RealtimeUser | null): ConnectionState {
  return {
    key,
    ws: null,
    connected: false,
    manuallyClosed: false,
    reconnectAttempt: 0,
    reconnectTimer: null,
    heartbeatTimer: null,
    pongTimer: null,
    pending: [],
    user,
  };
}

/** Invoke every handler, isolating failures so one bad listener can't break the rest. */
export function invokeAll<A extends unknown[]>(
  handlers: Iterable<(...args: A) => void> | undefined,
  args: A,
  label: string,
): void {
  if (!handlers) return;
  for (const handler of handlers) {
    try { handler(...args); } catch (error) {
      console.error(`[realtime] ${label} error`, error);
    }
  }
}
