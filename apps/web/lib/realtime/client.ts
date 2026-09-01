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
 *     - topicRefs: refcount per topic (how many on() calls)
 *     - subscribeRefs: number of live subscribe() callers (refcounted)
 *   Room is only cleaned up when BOTH topicRefs reach 0 AND subscribeRefs is 0.
 *   This prevents one component's cleanup from killing another's subscriptions.
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

// ── DIAGNOSTIC LOGGING (temporary) ────────────────────────────────────────
let _socketSeq = 0;
let _msgSeq = 0;
function _sid(ws: WebSocket | null): string {
  if (!ws) return "null";
  // Use a non-enumerable tag we set at creation time
  return (ws as unknown as { __diagId?: string }).__diagId ?? "unknown";
}
function _setSid(ws: WebSocket, id: string): void {
  (ws as unknown as { __diagId: string }).__diagId = id;
}
// ──────────────────────────────────────────────────────────────────────────

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
  /**
   * Number of live subscribe() callers for this room. Several hooks
   * (chat, typing, presence, sidebar) subscribe to the same room, so this
   * must be a refcount — a boolean lets the first cleanup flip it off for
   * everyone.
   */
  subscribeRefs: number;
}

interface ConnectionState {
  ws: WebSocket | null;
  connected: boolean;
  manuallyClosed: boolean;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
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
 *   subscribe(room)           → marks room as desired
 *   returned cleanup()        → marks room as undesired, removes if no handlers
 *
 * Room is only removed when BOTH:
 *   - All topic refcounts are 0 (no handlers)
 *   - subscribeRefs === 0 (no subscribe() callers)
 */
class RealtimeClient {
  /** roomName → connection state (one WebSocket per community or user room) */
  private connections = new Map<string, ConnectionState>();
  /** roomName → room subscription state */
  private rooms = new Map<string, RoomState>();

  private globalEvents = new Map<string, Set<EventHandler>>();
  private globalPresenceHandlers = new Set<PresenceHandler>();
  private globalStatusHandlers = new Set<StatusHandler>();
  private presenceCache = new Map<string, RealtimePresenceUser[]>();

  private sessionToken: string | null = null;
  /** Current user — applied to every connection, including ones created after init(). */
  private user: RealtimeUser | null = null;

  init(user: RealtimeUser): void {
    this.user = user;
    // Store user on all existing connections
    for (const [, conn] of this.connections) {
      if (!conn.user) conn.user = user;
    }
  }

  /** Set the session JWT for authenticated WebSocket connections. */
  setSessionToken(token: string): void {
    this.sessionToken = token;
  }

  connect(): void {
    console.log(`[RT-DIAG] CONNECT called`);
    // Connect all active connections
    for (const [room, conn] of this.connections) {
      conn.manuallyClosed = false;
      if (!conn.ws || conn.ws.readyState >= WebSocket.CLOSING) {
        console.log(`[RT-DIAG] CONNECT opening room=${room} socket=${_sid(conn.ws)}`);
        this.openConnection(conn);
      } else {
        console.log(`[RT-DIAG] CONNECT already open room=${room} socket=${_sid(conn.ws)} readyState=${conn.ws.readyState}`);
      }
    }
  }

  // ── Connection management ───────────────────────────────────────────

  private getOrCreateConnection(room: string): ConnectionState {
    let conn = this.connections.get(room);
    if (!conn) {
      conn = {
        ws: null,
        connected: false,
        manuallyClosed: false,
        reconnectAttempt: 0,
        reconnectTimer: null,
        pending: [],
        user: this.user,
      };
      this.connections.set(room, conn);
    }
    return conn;
  }

  private openConnection(conn: ConnectionState): void {
    if (conn.ws && conn.ws.readyState < WebSocket.CLOSING) return;

    // Get the room name from one of the rooms using this connection
    const roomName = this.getRoomForConnection(conn);
    if (!roomName) return;

    const url = buildWebSocketUrl(REALTIME_URL, roomName, this.sessionToken ?? undefined);
    if (!url) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect(conn);
      return;
    }
    const socketId = `s${++_socketSeq}`;
    _setSid(ws, socketId);
    conn.ws = ws;
    console.log(`[RT-DIAG] OPEN socket=${socketId} room=${roomName} readyState=${ws.readyState} conn.connected=${conn.connected}`);

    ws.onopen = () => {
      console.log(`[RT-DIAG] ONOPEN socket=${socketId} room=${roomName} readyState=${ws.readyState} pending=${conn!.pending.length}`);
      conn!.connected = true;
      conn!.reconnectAttempt = 0;
      this.emitGlobalStatus(true);

      if (conn!.user) {
        ws.send(JSON.stringify({ t: "join", user: conn!.user }));
      }

      // Clear stale typing events from the pending queue before flushing.
      // Typing state is ephemeral — if the connection dropped while typing,
      // we don't want to send a stale typing event on reconnect.
      conn!.pending = conn!.pending.filter((msg) => {
        try {
          const parsed = JSON.parse(msg);
          return !(parsed.t === "publish" && parsed.topic === "typing");
        } catch {
          return true;
        }
      });

      console.log(`[RT-DIAG] ONOPEN before-flush pending=${conn!.pending.length} socket=${socketId}`);
      this.resubscribeConnection(conn!);
      console.log(`[RT-DIAG] ONOPEN after-resubscribe pending=${conn!.pending.length} socket=${socketId}`);
      for (const msg of conn!.pending.splice(0)) {
        console.log(`[RT-DIAG] FLUSH socket=${socketId} msg=${msg.substring(0, 120)}`);
        ws.send(msg);
      }
      console.log(`[RT-DIAG] ONOPEN done pending=${conn!.pending.length} socket=${socketId}`);
    };

    ws.onmessage = (event) => {
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
      // Raw receipt log — fires for EVERY frame so delivery can be confirmed
      // independently of message shape.
      console.log(`[RT-DIAG] RECV_RAW socket=${socketId} room=${roomName} conn.ws===ws?${conn!.ws === ws} len=${String(event.data).length} head=${String(event.data).substring(0, 80)}`);
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        console.log(`[RT-DIAG] RECV_PARSE_FAIL socket=${socketId}`);
        return;
      }

      if (msg.t === "hello") {
        console.log(`[RT-DIAG] RECV hello socket=${socketId} connectionId=${msg.connectionId}`);
      } else if (msg.t === "event" && msg.topic) {
        // A community socket serves exactly one room, so prefer the room this
        // connection was opened for whenever the server-supplied room name is
        // missing or does not match a room we track. User-scoped sockets
        // ("user:global") multiplex several rooms and must use msg.room.
        const serverRoom = msg.room;
        const targetRoom =
          serverRoom && this.rooms.has(serverRoom)
            ? serverRoom
            : isCommunityRoom(roomName)
              ? roomName
              : serverRoom;
        if (msg.topic === "typing") {
          const eid = typeof msg.data === "object" && msg.data !== null ? (msg.data as Record<string, unknown>).eid : undefined;
          console.log(`[RT-DIAG] RECV typing socket=${socketId} room=${serverRoom} target=${targetRoom} sender=${msg.sender} eid=${eid ?? "?"} hasRoomState=${targetRoom ? this.rooms.has(targetRoom) : false}`);
        }
        if (targetRoom) {
          this.dispatchToRoom(targetRoom, msg.topic, msg.data, msg.sender);
        }
        this.dispatchGlobal(msg.topic, msg.data, msg.sender);
      } else if (msg.t === "presence" && msg.room) {
        this.presenceCache.set(msg.room, msg.users ?? []);
        this.emitRoomPresence(msg.room, msg.users ?? []);
        this.emitGlobalPresence(msg.users ?? []);
      } else if (msg.t === "presence_delta" && msg.room) {
        const cached = this.presenceCache.get(msg.room) ?? [];
        let updated: RealtimePresenceUser[];
        if (msg.joined) {
          updated = [...cached.filter((u) => u.id !== msg.joined!.id), msg.joined];
        } else if (msg.left) {
          updated = cached.filter((u) => u.id !== msg.left!.id);
        } else {
          updated = cached;
        }
        this.presenceCache.set(msg.room, updated);
        this.emitRoomPresence(msg.room, updated);
        this.emitGlobalPresence(updated);
      } else if (msg.t === "error") {
        console.warn("[realtime]", msg.message);
      }
    };

    ws.onclose = (ev) => {
      console.log(`[RT-DIAG] ONCLOSE socket=${socketId} room=${roomName} conn.ws===ws?${conn!.ws === ws} code=${ev.code} reason=${ev.reason} conn.connected=${conn!.connected}`);
      // Guard: if a newer socket has already replaced us, ignore this stale close.
      if (conn!.ws !== ws) {
        console.log(`[RT-DIAG] ONCLOSE STALE-GUARD socket=${socketId} (conn.ws=${_sid(conn!.ws)}) IGNORING`);
        return;
      }
      conn!.connected = false;
      this.emitGlobalStatus(false);
      if (!conn!.manuallyClosed) this.scheduleReconnect(conn!);
    };

    ws.onerror = (ev) => {
      console.log(`[RT-DIAG] ONERROR socket=${socketId} room=${roomName}`);
    };
  }

  private scheduleReconnect(conn: ConnectionState): void {
    if (conn.reconnectTimer !== null || conn.manuallyClosed) return;
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

  private resubscribeConnection(conn: ConnectionState): void {
    const roomName = this.getRoomForConnection(conn);
    if (!roomName) return;

    const state = this.rooms.get(roomName);
    if (!state) return;

    const hasHandlers = state.topicRefs.size > 0;
    console.log(`[RT-DIAG] RESUBSCRIBE room=${roomName} subscribeRefs=${state.subscribeRefs} hasHandlers=${hasHandlers} topics=[${[...state.topicRefs.keys()].join(",")}] socket=${_sid(conn.ws)}`);
    if (state.subscribeRefs > 0 || hasHandlers) {
      for (const [topic, refCount] of state.topicRefs) {
        if (refCount > 0) {
          console.log(`[RT-DIAG] RESUBSCRIBE sending topic=${topic} refCount=${refCount} socket=${_sid(conn.ws)}`);
          this.sendToConnection(conn, { t: "subscribe", room: roomName, topic });
        }
      }
    }
  }

  private getRoomForConnection(conn: ConnectionState): string | null {
    for (const [room, c] of this.connections) {
      if (c === conn) return room;
    }
    return null;
  }

  private getRoomConnection(room: string): ConnectionState {
    // Community-scoped rooms get their own connection keyed by room name
    // User-scoped rooms share a connection keyed by "user:${userId}"
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
   * Returns an unsubscribe function that cleans up when ALL users are done.
   */
  subscribe(room: string): () => void {
    const state = this.getOrCreateRoom(room);
    state.subscribeRefs += 1;
    console.log(`[RT-DIAG] SUBSCRIBE room=${room} subscribeRefs=${state.subscribeRefs}`);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      state.subscribeRefs = Math.max(0, state.subscribeRefs - 1);
      console.log(`[RT-DIAG] UNSUBSCRIBE room=${room} subscribeRefs=${state.subscribeRefs}`);
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

    console.log(`[RT-DIAG] ON room=${room} topic=${topic} prevRef=${prev} newRef=${prev + 1}`);

    // If this is the first handler for this topic, send subscribe
    if (prev === 0) {
      const conn = this.getRoomConnection(room);
      console.log(`[RT-DIAG] ON first-handler → sendSubscribe room=${room} topic=${topic} socket=${_sid(conn.ws)}`);
      this.sendToConnection(conn, { t: "subscribe", room, topic });
      // Ensure connection is open
      if (!conn.ws || conn.ws.readyState >= WebSocket.CLOSING) {
        this.openConnection(conn);
      }
    }

    // Return cleanup function
    return () => {
      topicSet!.delete(handler);
      const current = state.topicRefs.get(topic) ?? 0;
      if (current <= 1) {
        // Last handler removed — unsubscribe from server
        state.topicRefs.delete(topic);
        state.topicHandlers.delete(topic);
        const conn = this.getRoomConnection(room);
        if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
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

    return () => {
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
    const state = this.rooms.get(room);
    const typingSubscribed = state?.topicRefs.has("typing") ?? false;
    const typingRefCount = state?.topicRefs.get("typing") ?? 0;
    console.log(`[RT-DIAG] PUBLISH room=${room} topic=${topic} socket=${_sid(conn.ws)} readyState=${conn.ws?.readyState} conn.connected=${conn.connected} pending=${conn.pending.length} typingSubscribed=${typingSubscribed} typingRefCount=${typingRefCount} ws===conn.ws=true`);
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
      conn.pending = [];
      if (conn.ws) {
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
   * Remove a room from the map if it has no active handlers and is not subscribed.
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

    // Check if any other rooms use this connection
    for (const [r, c] of this.connections) {
      if (c === conn && r !== room) return;
    }

    // No other rooms — close and remove.
    // Mark as manually closed and detach the socket so the pending onclose
    // for this socket hits the stale guard instead of scheduling a reconnect
    // on a connection that no longer exists in the map.
    conn.manuallyClosed = true;
    if (conn.reconnectTimer !== null) {
      clearTimeout(conn.reconnectTimer);
      conn.reconnectTimer = null;
    }
    conn.pending = [];
    const ws = conn.ws;
    conn.ws = null;
    conn.connected = false;
    if (ws) {
      console.log(`[RT-DIAG] REMOVE_CONNECTION room=${room} socket=${_sid(ws)} readyState=${ws.readyState}`);
      try { ws.close(); } catch { /* ignore */ }
    }
    this.connections.delete(room);
  }

  private sendToConnection(conn: ConnectionState, msg: unknown): void {
    const json = JSON.stringify(msg);
    const isTyping = typeof msg === "object" && msg !== null && (msg as Record<string, unknown>).t === "publish" && (msg as Record<string, unknown>).topic === "typing";
    const isSubscribe = typeof msg === "object" && msg !== null && (msg as Record<string, unknown>).t === "subscribe";
    if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
      if (isTyping || isSubscribe) {
        console.log(`[RT-DIAG] SEND socket=${_sid(conn.ws)} readyState=${conn.ws.readyState} conn.connected=${conn.connected} msg=${json.substring(0, 150)}`);
      }
      conn.ws.send(json);
    } else {
      if (isTyping || isSubscribe) {
        console.log(`[RT-DIAG] QUEUED socket=${_sid(conn.ws)} readyState=${conn.ws?.readyState} conn.connected=${conn.connected} pending=${conn.pending.length} msg=${json.substring(0, 150)}`);
      }
      conn.pending.push(json);
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

/**
 * Singleton RealtimeClient shared across the entire app.
 * Manages multiple WebSockets — one per community + one for user rooms.
 */
export const realtimeClient = new RealtimeClient();
