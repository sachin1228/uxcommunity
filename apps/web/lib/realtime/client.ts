"use client";

/**
 * Singleton browser client for the Cloudflare realtime service.
 *
 * Architecture:
 *   Component → realtimeClient (singleton) → N WebSockets → CommunityDOs
 *   Each community-scoped room (chat:*, threads:*, etc.) gets its own
 *   WebSocket directly to the CommunityDO. User-scoped rooms (notifications:*, profile:*)
 *   still connect to UserDO.
 *
 * Reference-counted subscriptions:
 *   Each room tracks:
 *     - topicRefs:     refcount per topic (how many on() calls)
 *     - subscribeRefs: refcount of subscribe() callers
 *   Room is only cleaned up when topicRefs, subscribeRefs AND presence handlers
 *   all reach 0. This prevents one hook's cleanup (e.g. on tab-hide) from
 *   tearing down a socket another hook still depends on.
 *
 * Liveness:
 *   Every OPEN socket sends a "ping" heartbeat. The DO answers "pong" via
 *   setWebSocketAutoResponse (without waking from hibernation). If a pong is
 *   not seen within the deadline the socket is considered dead and recycled.
 *   On tab visibility → visible we also probe every socket immediately, so a
 *   connection that silently died while the tab was in the background is
 *   replaced before the user starts typing.
 */

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

type EventHandler = (data: unknown, sender?: string) => void;
type PresenceHandler = (users: RealtimePresenceUser[]) => void;
type StatusHandler = (connected: boolean) => void;

const REALTIME_URL = process.env.NEXT_PUBLIC_REALTIME_URL ?? "";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;
/** How often to send a heartbeat on an idle-but-open socket. */
const HEARTBEAT_INTERVAL_MS = 25_000;
/** How long to wait for a pong before declaring the socket dead. */
const HEARTBEAT_TIMEOUT_MS = 6_000;
const PING_FRAME = "ping";
const PONG_FRAME = "pong";

/** Community-scoped room prefixes that get their own WebSocket. */
const COMMUNITY_ROOM_PREFIXES = ["chat:", "threads:", "events:", "resources:", "showcase:", "rules:", "thread-comments:", "resource-comments:"];

function isCommunityRoom(room: string): boolean {
  return COMMUNITY_ROOM_PREFIXES.some((prefix) => room.startsWith(prefix));
}

function buildWebSocketUrl(baseUrl: string, room: string, token?: string): string {
  if (!baseUrl) {
    return `/ws?room=${encodeURIComponent(room)}`;
  }
  const wsBase = baseUrl.replace(/^http/, "ws");
  const params = new URLSearchParams({ room });
  if (token) params.set("token", token);
  return `${wsBase}/ws?${params.toString()}`;
}

interface RoomState {
  room: string;
  /** Reference count per topic — incremented by on(), decremented by returned cleanup. */
  topicRefs: Map<string, number>;
  /** Actual handler sets per topic. */
  topicHandlers: Map<string, Set<EventHandler>>;
  presenceHandlers: Set<PresenceHandler>;
  /** Number of live subscribe() callers for this room. */
  subscribeRefs: number;
}

interface ConnectionState {
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

/**
 * Singleton RealtimeClient — one per browser session.
 *
 * Manages multiple WebSockets:
 *   - One per active community (for community-scoped rooms)
 *   - One for user-scoped rooms (notifications, profile, designers-studio)
 *
 * Reference-counted lifecycle:
 *   on(room, topic, handler)  → increments topic refcount, subscribes if first
 *   returned cleanup()        → decrements refcount, unsubscribes if last
 *   subscribe(room)           → increments room refcount
 *   returned cleanup()        → decrements room refcount (idempotent)
 *
 * Room is only removed when ALL of:
 *   - All topic refcounts are 0 (no handlers)
 *   - subscribeRefs === 0 (no subscribe() callers)
 *   - No presence handlers
 */
class RealtimeClient {
  /** connection key (room name or "user:global") → connection state */
  private connections = new Map<string, ConnectionState>();
  /** roomName → room subscription state */
  private rooms = new Map<string, RoomState>();

  private globalEvents = new Map<string, Set<EventHandler>>();
  private globalPresenceHandlers = new Set<PresenceHandler>();
  private globalStatusHandlers = new Set<StatusHandler>();
  private presenceCache = new Map<string, RealtimePresenceUser[]>();

  private sessionToken: string | null = null;
  /** Identity persisted across connections so sockets created later still send `join`. */
  private user: RealtimeUser | null = null;
  private lifecycleBound = false;

  init(user: RealtimeUser): void {
    this.user = user;
    // Store user on all existing connections
    for (const [, conn] of this.connections) {
      if (!conn.user) conn.user = user;
    }
    this.bindLifecycle();
  }

  /** Set the session JWT for authenticated WebSocket connections. */
  setSessionToken(token: string): void {
    this.sessionToken = token;
  }

  connect(): void {
    // Connect all active connections
    for (const [, conn] of this.connections) {
      conn.manuallyClosed = false;
      if (!conn.ws || conn.ws.readyState >= WebSocket.CLOSING) {
        this.openConnection(conn);
      }
    }
  }

  // ── Browser lifecycle ───────────────────────────────────────────────

  /**
   * When the tab becomes visible again (or the network comes back) probe every
   * socket immediately. Background tabs get their timers throttled and their
   * sockets can die without firing `close`, so `readyState` lies until we ask.
   */
  private bindLifecycle(): void {
    if (this.lifecycleBound || typeof window === "undefined") return;
    this.lifecycleBound = true;
    const probeAll = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      for (const [, conn] of this.connections) this.probeConnection(conn);
    };
    document.addEventListener("visibilitychange", probeAll);
    window.addEventListener("focus", probeAll);
    window.addEventListener("online", probeAll);
    window.addEventListener("pageshow", probeAll);
  }

  /** Immediately verify a connection is alive; reconnect if it isn't. */
  private probeConnection(conn: ConnectionState): void {
    if (conn.manuallyClosed) return;
    if (!conn.ws || conn.ws.readyState >= WebSocket.CLOSING) {
      // Socket is gone — reconnect right now rather than waiting for backoff.
      if (conn.reconnectTimer !== null) {
        clearTimeout(conn.reconnectTimer);
        conn.reconnectTimer = null;
      }
      conn.reconnectAttempt = 0;
      this.openConnection(conn);
      return;
    }
    if (conn.ws.readyState === WebSocket.OPEN) this.sendPing(conn);
  }

  // ── Connection management ───────────────────────────────────────────

  private getOrCreateConnection(key: string): ConnectionState {
    let conn = this.connections.get(key);
    if (!conn) {
      conn = {
        key,
        ws: null,
        connected: false,
        manuallyClosed: false,
        reconnectAttempt: 0,
        reconnectTimer: null,
        heartbeatTimer: null,
        pongTimer: null,
        pending: [],
        user: this.user,
      };
      this.connections.set(key, conn);
    }
    return conn;
  }

  private openConnection(conn: ConnectionState): void {
    if (conn.ws && conn.ws.readyState < WebSocket.CLOSING) return;
    if (conn.manuallyClosed) return;

    // Only open sockets for connections that are still registered.
    if (this.connections.get(conn.key) !== conn) return;

    const url = buildWebSocketUrl(REALTIME_URL, conn.key, this.sessionToken ?? undefined);
    if (!url) return;

    // Detach any stale socket so its late events cannot touch this connection.
    if (conn.ws) this.detachSocket(conn.ws);

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect(conn);
      return;
    }
    conn.ws = ws;

    ws.onopen = () => {
      if (conn.ws !== ws) return;
      conn.connected = true;
      conn.reconnectAttempt = 0;

      if (conn.user) {
        ws.send(JSON.stringify({ t: "join", user: conn.user }));
      }

      // Subscriptions are authoritative from local refcounts, so replay them
      // first (the server requires a subscription before accepting a publish),
      // then flush any queued non-subscription frames.
      this.resubscribeConnection(conn);
      for (const frame of conn.pending.splice(0)) {
        if (isSubscriptionFrame(frame)) continue;
        ws.send(frame);
      }

      this.startHeartbeat(conn);
      this.emitGlobalStatus(true);
    };

    ws.onmessage = (event) => {
      if (conn.ws !== ws) return;
      const raw = String(event.data);

      if (raw === PONG_FRAME) {
        this.clearPongTimer(conn);
        return;
      }

      let msg: {
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
      };
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      // Any inbound frame proves the socket is alive.
      this.clearPongTimer(conn);

      // Community sockets are 1:1 with a room; if the server-supplied room is
      // not one we track, fall back to the connection's own room.
      const room = msg.room && this.rooms.has(msg.room)
        ? msg.room
        : isCommunityRoom(conn.key) ? conn.key : msg.room;

      if (msg.t === "hello") {
        // Connection established
      } else if (msg.t === "event" && msg.topic && room) {
        this.dispatchToRoom(room, msg.topic, msg.data, msg.sender);
        this.dispatchGlobal(msg.topic, msg.data, msg.sender);
      } else if (msg.t === "presence" && room) {
        this.presenceCache.set(room, msg.users ?? []);
        this.emitRoomPresence(room, msg.users ?? []);
        this.emitGlobalPresence(msg.users ?? []);
      } else if (msg.t === "presence_delta" && room) {
        const cached = this.presenceCache.get(room) ?? [];
        let updated: RealtimePresenceUser[];
        if (msg.joined) {
          updated = [...cached.filter((u) => u.id !== msg.joined!.id), msg.joined];
        } else if (msg.left) {
          updated = cached.filter((u) => u.id !== msg.left!.id);
        } else {
          updated = cached;
        }
        this.presenceCache.set(room, updated);
        this.emitRoomPresence(room, updated);
        this.emitGlobalPresence(updated);
      } else if (msg.t === "error") {
        console.warn("[realtime]", msg.message);
      }
    };

    ws.onclose = () => {
      // Ignore close events from sockets this connection no longer owns.
      if (conn.ws !== ws) return;
      conn.ws = null;
      conn.connected = false;
      this.stopHeartbeat(conn);
      this.emitGlobalStatus(this.isConnected());
      if (!conn.manuallyClosed) this.scheduleReconnect(conn);
    };

    ws.onerror = () => {};
  }

  private detachSocket(ws: WebSocket): void {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
  }

  private scheduleReconnect(conn: ConnectionState): void {
    if (conn.reconnectTimer !== null || conn.manuallyClosed) return;
    if (this.connections.get(conn.key) !== conn) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** conn.reconnectAttempt,
      RECONNECT_MAX_MS,
    );
    conn.reconnectAttempt += 1;
    conn.reconnectTimer = setTimeout(() => {
      conn.reconnectTimer = null;
      this.openConnection(conn);
    }, delay);
  }

  // ── Heartbeat ───────────────────────────────────────────────────────

  private startHeartbeat(conn: ConnectionState): void {
    this.stopHeartbeat(conn);
    conn.heartbeatTimer = setInterval(() => this.sendPing(conn), HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(conn: ConnectionState): void {
    if (conn.heartbeatTimer !== null) {
      clearInterval(conn.heartbeatTimer);
      conn.heartbeatTimer = null;
    }
    this.clearPongTimer(conn);
  }

  private clearPongTimer(conn: ConnectionState): void {
    if (conn.pongTimer !== null) {
      clearTimeout(conn.pongTimer);
      conn.pongTimer = null;
    }
  }

  private sendPing(conn: ConnectionState): void {
    const ws = conn.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    // A probe is already in flight — don't stack deadlines.
    if (conn.pongTimer !== null) return;
    try {
      ws.send(PING_FRAME);
    } catch {
      this.recycleConnection(conn);
      return;
    }
    conn.pongTimer = setTimeout(() => {
      conn.pongTimer = null;
      if (conn.ws !== ws) return;
      // No pong: the socket is half-open. Tear it down and reconnect now.
      this.recycleConnection(conn);
    }, HEARTBEAT_TIMEOUT_MS);
  }

  /** Force-close a suspected-dead socket and reconnect immediately. */
  private recycleConnection(conn: ConnectionState): void {
    const ws = conn.ws;
    this.stopHeartbeat(conn);
    conn.ws = null;
    conn.connected = false;
    if (ws) {
      this.detachSocket(ws);
      try { ws.close(); } catch { /* ignore */ }
    }
    this.emitGlobalStatus(this.isConnected());
    if (conn.manuallyClosed) return;
    if (conn.reconnectTimer !== null) {
      clearTimeout(conn.reconnectTimer);
      conn.reconnectTimer = null;
    }
    conn.reconnectAttempt = 0;
    this.openConnection(conn);
  }

  private resubscribeConnection(conn: ConnectionState): void {
    const state = this.rooms.get(conn.key);
    if (state) {
      for (const [topic, refCount] of state.topicRefs) {
        if (refCount > 0) {
          this.sendToConnection(conn, { t: "subscribe", room: conn.key, topic });
        }
      }
    }

    // The shared user connection carries many rooms — replay all of them.
    if (!isCommunityRoom(conn.key)) {
      for (const [room, roomState] of this.rooms) {
        if (isCommunityRoom(room)) continue;
        for (const [topic, refCount] of roomState.topicRefs) {
          if (refCount > 0) {
            this.sendToConnection(conn, { t: "subscribe", room, topic });
          }
        }
      }
    }
  }

  private getRoomConnection(room: string): ConnectionState {
    // Community-scoped rooms get their own connection keyed by room name
    // User-scoped rooms share a connection keyed by "user:global"
    if (isCommunityRoom(room)) {
      return this.getOrCreateConnection(room);
    }
    // For non-community rooms, use a shared "user" connection
    return this.getOrCreateConnection("user:global");
  }

  // ── Subscription management (reference-counted) ──────────────────────────

  /**
   * Mark a room as desired. Does NOT create subscriptions by itself.
   * Pair with on() to subscribe to specific topics.
   * Returns an idempotent release function; the room is only torn down when
   * every subscribe() caller has released AND no handlers remain.
   */
  subscribe(room: string): () => void {
    const state = this.getOrCreateRoom(room);
    state.subscribeRefs += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.rooms.get(room);
      if (!current) return;
      current.subscribeRefs = Math.max(0, current.subscribeRefs - 1);
      this.maybeRemoveRoom(room);
    };
  }

  /**
   * @deprecated Use the ref-counted on()/subscribe() pattern instead.
   * This method forcefully removes a room. Only use if you are the sole consumer.
   */
  unsubscribe(room: string): void {
    const state = this.rooms.get(room);
    if (!state) return;

    const conn = this.getRoomConnection(room);
    if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
      for (const [topic, refCount] of state.topicRefs) {
        if (refCount > 0) {
          this.sendToConnection(conn, { t: "unsubscribe", room, topic });
        }
      }
    }

    state.topicRefs.clear();
    state.topicHandlers.clear();
    state.presenceHandlers.clear();
    state.subscribeRefs = 0;
    this.rooms.delete(room);
    this.presenceCache.delete(room);

    this.maybeRemoveConnection(room);
  }

  /**
   * Register an event handler for a specific room + topic.
   * Reference-counted: the topic subscription stays active as long as
   * at least one handler is registered. Returns a cleanup function.
   */
  on(room: string, topic: string, handler: EventHandler): () => void {
    const state = this.getOrCreateRoom(room);

    // Increment refcount
    const prev = state.topicRefs.get(topic) ?? 0;
    state.topicRefs.set(topic, prev + 1);

    // Add handler
    let topicSet = state.topicHandlers.get(topic);
    if (!topicSet) {
      topicSet = new Set();
      state.topicHandlers.set(topic, topicSet);
    }
    topicSet.add(handler);

    // If this is the first handler for this topic, send subscribe
    if (prev === 0) {
      const conn = this.getRoomConnection(room);
      conn.manuallyClosed = false;
      this.sendToConnection(conn, { t: "subscribe", room, topic });
    }

    let released = false;
    // Return cleanup function
    return () => {
      if (released) return;
      released = true;
      topicSet!.delete(handler);
      const current = state.topicRefs.get(topic) ?? 0;
      if (current <= 1) {
        // Last handler removed — unsubscribe from server
        state.topicRefs.delete(topic);
        state.topicHandlers.delete(topic);
        const conn = this.connections.get(isCommunityRoom(room) ? room : "user:global");
        if (conn?.ws && conn.ws.readyState === WebSocket.OPEN) {
          this.sendToConnection(conn, { t: "unsubscribe", room, topic });
        }
      } else {
        state.topicRefs.set(topic, current - 1);
      }
      this.maybeRemoveRoom(room);
    };
  }

  off(room: string, topic: string, handler: EventHandler): void {
    const state = this.rooms.get(room);
    if (!state) return;
    const topicSet = state.topicHandlers.get(topic);
    if (topicSet) topicSet.delete(handler);
  }

  onPresence(room: string, handler: PresenceHandler): () => void {
    const state = this.getOrCreateRoom(room);
    state.presenceHandlers.add(handler);

    const cached = this.presenceCache.get(room);
    if (cached) {
      try { handler(cached); } catch { /* ignore */ }
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      state.presenceHandlers.delete(handler);
      this.maybeRemoveRoom(room);
    };
  }

  onStatus(handler: StatusHandler): () => void {
    this.globalStatusHandlers.add(handler);
    return () => {
      this.globalStatusHandlers.delete(handler);
    };
  }

  // ── Publishing ────────────────────────────────────────────────────────────

  publish(room: string, topic: string, data: unknown): void {
    const conn = this.getRoomConnection(room);
    conn.manuallyClosed = false;
    this.sendToConnection(conn, { t: "publish", room, topic, data });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  close(): void {
    for (const [, conn] of this.connections) {
      conn.manuallyClosed = true;
      if (conn.reconnectTimer !== null) {
        clearTimeout(conn.reconnectTimer);
        conn.reconnectTimer = null;
      }
      this.stopHeartbeat(conn);
      conn.pending = [];
      if (conn.ws) {
        this.detachSocket(conn.ws);
        try { conn.ws.close(); } catch { /* ignore */ }
        conn.ws = null;
      }
      conn.connected = false;
    }
    this.emitGlobalStatus(false);
  }

  destroy(): void {
    this.close();
    this.rooms.clear();
    this.presenceCache.clear();
    this.globalEvents.clear();
    this.globalPresenceHandlers.clear();
    this.globalStatusHandlers.clear();
    this.connections.clear();
  }

  isConnected(): boolean {
    for (const [, conn] of this.connections) {
      if (conn.connected) return true;
    }
    return false;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private getOrCreateRoom(room: string): RoomState {
    let state = this.rooms.get(room);
    if (!state) {
      state = {
        room,
        topicRefs: new Map(),
        topicHandlers: new Map(),
        presenceHandlers: new Set(),
        subscribeRefs: 0,
      };
      this.rooms.set(room, state);
    }
    return state;
  }

  /**
   * Remove a room from the map if it has no active handlers and no subscribers.
   */
  private maybeRemoveRoom(room: string): void {
    const state = this.rooms.get(room);
    if (!state) return;
    const hasHandlers = state.topicRefs.size > 0;
    if (state.subscribeRefs === 0 && !hasHandlers && state.presenceHandlers.size === 0) {
      this.rooms.delete(room);
      this.presenceCache.delete(room);
      this.maybeRemoveConnection(room);
    }
  }

  private maybeRemoveConnection(room: string): void {
    if (!isCommunityRoom(room)) return;
    const conn = this.connections.get(room);
    if (!conn) return;

    // Mark closed BEFORE closing so a late `onclose` cannot schedule a reconnect.
    conn.manuallyClosed = true;
    if (conn.reconnectTimer !== null) {
      clearTimeout(conn.reconnectTimer);
      conn.reconnectTimer = null;
    }
    this.stopHeartbeat(conn);
    conn.pending = [];
    if (conn.ws) {
      this.detachSocket(conn.ws);
      try { conn.ws.close(); } catch { /* ignore */ }
      conn.ws = null;
    }
    conn.connected = false;
    this.connections.delete(room);
  }

  private sendToConnection(conn: ConnectionState, msg: unknown): void {
    const json = JSON.stringify(msg);
    if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(json);
      return;
    }
    conn.pending.push(json);
    // Ensure a socket is on its way so the queued frame actually flushes.
    if (!conn.manuallyClosed && (!conn.ws || conn.ws.readyState >= WebSocket.CLOSING)) {
      this.openConnection(conn);
    }
  }

  private dispatchToRoom(room: string, topic: string, data: unknown, sender?: string): void {
    const state = this.rooms.get(room);
    if (!state) return;
    const handlers = state.topicHandlers.get(topic);
    if (!handlers) return;
    for (const handler of handlers) {
      try { handler(data, sender); } catch (error) {
        console.error("[realtime] event handler error", error);
      }
    }
  }

  private dispatchGlobal(topic: string, data: unknown, sender?: string): void {
    const handlers = this.globalEvents.get(topic);
    if (!handlers) return;
    for (const handler of handlers) {
      try { handler(data, sender); } catch (error) {
        console.error("[realtime] global event handler error", error);
      }
    }
  }

  private emitRoomPresence(room: string, users: RealtimePresenceUser[]): void {
    const state = this.rooms.get(room);
    if (!state) return;
    for (const handler of state.presenceHandlers) {
      try { handler(users); } catch (error) {
        console.error("[realtime] presence handler error", error);
      }
    }
  }

  private emitGlobalPresence(users: RealtimePresenceUser[]): void {
    for (const handler of this.globalPresenceHandlers) {
      try { handler(users); } catch (error) {
        console.error("[realtime] global presence handler error", error);
      }
    }
  }

  private emitGlobalStatus(connected: boolean): void {
    for (const handler of this.globalStatusHandlers) {
      try { handler(connected); } catch (error) {
        console.error("[realtime] status handler error", error);
      }
    }
  }
}

function isSubscriptionFrame(frame: string): boolean {
  try {
    const parsed = JSON.parse(frame) as { t?: string };
    return parsed.t === "subscribe" || parsed.t === "unsubscribe";
  } catch {
    return false;
  }
}

/**
 * Singleton RealtimeClient shared across the entire app.
 * Manages multiple WebSockets — one per community + one for user rooms.
 */
export const realtimeClient = new RealtimeClient();
