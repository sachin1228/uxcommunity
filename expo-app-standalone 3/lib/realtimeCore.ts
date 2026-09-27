/**
 * Mobile realtime client core — the platform-free half of the client.
 *
 * WHY THIS IS ITS OWN MODULE: this file owns the socket lifecycle (connect,
 * reconnect, subscription replay, gap signalling, teardown) and imports nothing
 * from React Native, so that lifecycle is unit-testable in Node with a fake
 * socket (`lib/realtimeCore.test.ts`). The app-facing singleton in
 * `lib/realtime.ts` supplies the three platform pieces it needs: the
 * authenticated URL, the socket constructor, and the foreground probe.
 *
 * Architecture (unchanged from the web client, `apps/web/lib/realtime/client.ts`):
 *   hook → realtimeClient (singleton) → one WebSocket per community room,
 *                                      plus one WebSocket per user (UserDO).
 *
 * Socket keys:
 *   Community-scoped rooms (chat:*, threads:*, events:*, resources:*,
 *   showcase:*, rules:*, thread-comments:*, resource-comments:*) get their own
 *   socket, keyed by the room name itself.
 *   User-scoped rooms (notifications:*, profile:*) multiplex over ONE socket
 *   keyed `user:${userId}` — the exact instance `resolveRoomTarget` in
 *   `apps/realtime/src/room-routing.ts` publishes those rooms to. Before an
 *   identity exists the placeholder `user:global` is used and `init()` re-keys
 *   the socket, so a socket opened before sign-in still lands on the right DO.
 *
 * Reference-counted subscriptions (mirrors the web client):
 *   on(room, topic, handler)  → topicRefs++, subscribe frame on the first handler
 *   returned cleanup()        → topicRefs--, unsubscribe frame on the last
 *   subscribe(room)           → subscribeRefs++ ; cleanup() → subscribeRefs--
 *   A room is only torn down when topicRefs, subscribeRefs AND presence handlers
 *   are all empty. Without this, one screen's cleanup killed a socket the
 *   community list still depended on — messages stopped arriving until restart.
 *
 * Liveness (the mobile-specific part):
 *   Every OPEN socket sends a `ping` heartbeat; the DO answers `pong` through
 *   `setWebSocketAutoResponse` without waking from hibernation. If a pong is not
 *   seen within the deadline the socket is considered dead and recycled, because
 *   mobile OSes suspend the app and silently kill sockets while `readyState`
 *   keeps reporting OPEN. Returning to the foreground (or regaining the network)
 *   probes every socket immediately instead of waiting for the backoff.
 *
 * Reconnect correctness:
 *   Subscriptions are replayed from local refcounts on every open, so the
 *   server's view is rebuilt from *desired* state rather than from frame
 *   history — a queued frame that removes a subscription is therefore never
 *   replayed (`isSubscriptionFrame`). Sockets cannot deliver what was published
 *   while they were down, so `onRoomStatus(room, …)` tells the hooks when a
 *   socket re-opened and they catch the gap up from the API.
 *
 * Authentication: the session JWT rides in the `token` query parameter, because
 * React Native's WebSocket API cannot send custom headers.
 */

export interface RealtimeUser {
  id: string;
  name: string | null;
  avatar: string | null;
}

/**
 * Presence payload for a room — how many distinct members are online.
 *
 * The server counts the members it has sockets for (multi-device folded into
 * one member) and broadcasts that number; it is not a roster. Kept in sync with
 * `apps/web/lib/realtime/client.ts`.
 */
export interface RealtimePresence {
  count: number;
}

export type RealtimeEventHandler = (data: unknown, sender?: string) => void;
export type RealtimePresenceHandler = (presence: RealtimePresence) => void;
export type RealtimeStatusHandler = (connected: boolean) => void;

/** The slice of the WebSocket API this client uses — faked in tests. */
export interface RealtimeSocket {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string | ArrayBuffer }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** Everything this core needs from the platform it runs on. */
export interface RealtimePlatform {
  /**
   * URL for a socket key — `wss://…/ws?room=<key>&token=<jwt>`. Resolved on
   * every open attempt, so a rotated session token is picked up without an
   * app restart.
   */
  buildSocketUrl(socketKey: string): Promise<string>;
  createSocket(url: string): RealtimeSocket;
  /** Fires when the app returns to the foreground. Returns an unsubscribe. */
  onForeground(handler: () => void): () => void;
}

/** Timing knobs — defaults are production values; tests shrink the backoff. */
export interface RealtimeTimings {
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
}

const DEFAULT_RECONNECT_BASE_MS = 1000;
const DEFAULT_RECONNECT_MAX_MS = 15_000;
/** How often to send a heartbeat on an idle-but-open socket. */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 25_000;
/** How long to wait for a pong before declaring the socket dead. */
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 6_000;

const PING_FRAME = 'ping';
const PONG_FRAME = 'pong';

/** WebSocket readyState values (the global constant object is not needed). */
const SOCKET_OPEN = 1;
const SOCKET_CLOSING = 2;

/** Community-scoped room prefixes that get their own WebSocket. */
const COMMUNITY_ROOM_PREFIXES = [
  'chat:',
  'threads:',
  'events:',
  'resources:',
  'showcase:',
  'rules:',
  'thread-comments:',
  'resource-comments:',
];

/** True when a room lives in a community's DO rather than the user's DO. */
export function isCommunityRoom(room: string): boolean {
  return COMMUNITY_ROOM_PREFIXES.some((prefix) => room.startsWith(prefix));
}

/**
 * User-scoped room prefixes — keep in sync with the server's
 * `USER_ROOM_PREFIXES` (`apps/realtime/src/room-routing.ts`).
 */
export const USER_ROOM_PREFIXES = ['notifications:', 'profile:'] as const;

/**
 * The member a user-scoped room belongs to, or null for a community room.
 */
export function userRoomOwner(room: string): string | null {
  for (const prefix of USER_ROOM_PREFIXES) {
    if (room.startsWith(prefix)) return room.slice(prefix.length) || null;
  }
  return null;
}

/**
 * Socket key for every user-scoped room.
 *
 * `user:${userId}` is the DO instance the server publishes user-scoped rooms to
 * (`resolveRoomTarget` in `apps/realtime/src/room-routing.ts`). Until the
 * identity is known the placeholder key is used and `init()` re-keys it — a
 * socket parked on the wrong instance receives nothing, silently.
 */
export function userSocketKey(userId: string | null | undefined): string {
  return userId ? `user:${userId}` : 'user:global';
}

/**
 * Room name helpers — keep in sync with `apps/web/lib/realtime/rooms.ts`.
 */
export const realtimeRooms = {
  chat: (communityId: string) => `chat:${communityId}`,
  presence: (communityId: string) => `presence:${communityId}`,
  threads: (communityId: string) => `threads:${communityId}`,
  threadComments: (threadId: string) => `thread-comments:${threadId}`,
  events: (communityId: string) => `events:${communityId}`,
  resources: (communityId: string) => `resources:${communityId}`,
  resourceComments: (resourceId: string) => `resource-comments:${resourceId}`,
  showcase: (postId: string) => `showcase:${postId}`,
  rules: (communityId: string) => `rules:${communityId}`,
  notifications: (userId: string) => `notifications:${userId}`,
} as const;

interface RoomState {
  room: string;
  /** Reference count per topic — incremented by on(), decremented by the cleanup. */
  topicRefs: Map<string, number>;
  /** Actual handler sets per topic. */
  topicHandlers: Map<string, Set<RealtimeEventHandler>>;
  presenceHandlers: Set<RealtimePresenceHandler>;
  /** Number of live subscribe() callers for this room. */
  subscribeRefs: number;
}

interface ConnectionState {
  /** The socket key this connection is registered under in `connections`. */
  key: string;
  ws: RealtimeSocket | null;
  /** True while an async open is in flight, so two callers cannot open two sockets. */
  opening: boolean;
  connected: boolean;
  /** True once a socket for this connection has been open at least once. */
  openedOnce: boolean;
  manuallyClosed: boolean;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  pongTimer: ReturnType<typeof setTimeout> | null;
  pending: string[];
  user: RealtimeUser | null;
}

/**
 * Singleton RealtimeClient — one per app session.
 *
 * Manages multiple sockets: one per active community (community-scoped rooms)
 * plus one multiplexed socket for every user-scoped room.
 */
export class RealtimeClient {
  private connections = new Map<string, ConnectionState>();
  private rooms = new Map<string, RoomState>();
  /** socketKey → handlers that want to know when that socket (re)opens / drops. */
  private roomStatusHandlers = new Map<string, Set<RealtimeStatusHandler>>();

  private globalEvents = new Map<string, Set<RealtimeEventHandler>>();
  private globalPresenceHandlers = new Set<RealtimePresenceHandler>();
  private globalStatusHandlers = new Set<RealtimeStatusHandler>();
  private presenceCache = new Map<string, RealtimePresence>();

  /** Identity persisted across connections so sockets created later still `join`. */
  private user: RealtimeUser | null = null;
  private lifecycleBound = false;
  /**
   * Bumped by every `destroy()`. Cleanup closures captured by the previous
   * session compare against it and become inert, so an unmounting screen from
   * the account that just left cannot release the next account's rooms.
   */
  private session = 0;

  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;

  constructor(
    private readonly platform: RealtimePlatform,
    timings: RealtimeTimings = {},
  ) {
    this.reconnectBaseMs = timings.reconnectBaseMs ?? DEFAULT_RECONNECT_BASE_MS;
    this.reconnectMaxMs = timings.reconnectMaxMs ?? DEFAULT_RECONNECT_MAX_MS;
    this.heartbeatIntervalMs = timings.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimeoutMs = timings.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;
  }

  /**
   * Declare (or replace) the signed-in identity.
   *
   * A different id than the one currently in use re-keys the user socket to
   * `user:${userId}` and re-joins every remaining socket, so an account switch
   * can never leave a socket joined as the previous member. Callers that know a
   * session ended should still prefer `destroy()`/`resetRealtimeSession()` so
   * the previous account's rooms and caches are dropped outright.
   */
  init(user: RealtimeUser): void {
    const previousKey = this.userSocketKey();
    const identityChanged = this.user !== null && this.user.id !== user.id;
    this.user = user;

    const nextKey = this.userSocketKey();
    if (previousKey !== nextKey) this.migrateConnection(previousKey, nextKey);

    for (const [, conn] of this.connections) {
      if (identityChanged || !conn.user) conn.user = user;
    }
    if (identityChanged) {
      // The previous identity's presence data and user rooms belong to that
      // account, and a socket already joined as them must say `join` again.
      this.presenceCache.clear();
      this.forgetOtherUsersRooms(user.id);
      for (const [, conn] of this.connections) this.rejoinConnection(conn);
    }

    this.bindLifecycle();
  }

  /** Socket key every user-scoped room multiplexes over, right now. */
  private userSocketKey(): string {
    return userSocketKey(this.user?.id);
  }

  /**
   * Move the user-scoped socket to a new socket key, replaying its local
   * subscriptions on the replacement socket.
   */
  private migrateConnection(fromKey: string, toKey: string): void {
    const previous = this.connections.get(fromKey);
    if (!previous) return;

    this.teardownConnection(previous, { keepUser: true });
    this.connections.delete(fromKey);

    const stillWanted = [...this.rooms.values()].some(
      (state) =>
        !isCommunityRoom(state.room) &&
        (state.subscribeRefs > 0 || state.topicRefs.size > 0 || state.presenceHandlers.size > 0),
    );
    if (stillWanted) {
      const next = this.getOrCreateConnection(toKey);
      next.user = this.user;
      void this.openConnection(next);
    }
  }

  /**
   * Forget user-scoped rooms that belong to a different member (the account
   * that just left). No screen in the new session can legitimately receive
   * them, and replaying them would subscribe this socket to the previous
   * account's events.
   */
  private forgetOtherUsersRooms(userId: string): void {
    for (const [room, state] of [...this.rooms]) {
      const owner = userRoomOwner(room);
      if (!owner || owner === userId) continue;
      state.topicRefs.clear();
      state.topicHandlers.clear();
      state.presenceHandlers.clear();
      state.subscribeRefs = 0;
      this.rooms.delete(room);
      this.presenceCache.delete(room);
    }
  }

  /**
   * Re-open a socket that is already joined as another member so it says `join`
   * again with the current identity. Subscriptions replay on open.
   */
  private rejoinConnection(conn: ConnectionState): void {
    if (!conn.ws && !conn.openedOnce) return;
    this.teardownConnection(conn, { keepUser: true });
    conn.manuallyClosed = false;
    conn.reconnectAttempt = 0;
    void this.openConnection(conn);
  }

  /**
   * When the app comes back to the foreground, probe every socket immediately.
   * A backgrounded app gets its sockets killed without a `close` event, so
   * `readyState` lies until we ask.
   */
  private bindLifecycle(): void {
    if (this.lifecycleBound) return;
    this.lifecycleBound = true;
    // One listener for the app's lifetime, exactly like the AppState listener
    // it replaces — it reads the live connection table on every foreground.
    this.platform.onForeground(() => {
      for (const [, conn] of this.connections) this.probeConnection(conn);
    });
  }

  /** Immediately verify a connection is alive; reconnect if it isn't. */
  private probeConnection(conn: ConnectionState): void {
    if (conn.manuallyClosed) return;
    if (!conn.ws || conn.ws.readyState >= SOCKET_CLOSING) {
      // Socket is gone — reconnect now rather than waiting for backoff.
      if (conn.reconnectTimer !== null) {
        clearTimeout(conn.reconnectTimer);
        conn.reconnectTimer = null;
      }
      conn.reconnectAttempt = 0;
      void this.openConnection(conn);
      return;
    }
    if (conn.ws.readyState === SOCKET_OPEN) this.sendPing(conn);
  }

  /**
   * Opens (or re-opens) connections.
   *
   * Pass a room to (re)open just that room's socket — the chat hooks call
   * `connect(room)` right after `init()`. Omit it to re-open every tracked
   * connection, which is what a global reconnect does.
   */
  connect(room?: string): void {
    if (room) {
      const conn = this.getRoomConnection(room);
      conn.manuallyClosed = false;
      if (!conn.ws || conn.ws.readyState >= SOCKET_CLOSING) {
        void this.openConnection(conn);
      }
      return;
    }

    for (const [, conn] of this.connections) {
      conn.manuallyClosed = false;
      if (!conn.ws || conn.ws.readyState >= SOCKET_CLOSING) {
        void this.openConnection(conn);
      }
    }
  }

  // ── Connection management ───────────────────────────────────────────

  private getOrCreateConnection(key: string): ConnectionState {
    let conn = this.connections.get(key);
    if (!conn) {
      conn = {
        key,
        ws: null,
        opening: false,
        connected: false,
        openedOnce: false,
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

  private async openConnection(conn: ConnectionState): Promise<void> {
    if (conn.ws && conn.ws.readyState < SOCKET_CLOSING) return;
    if (conn.opening) return;
    if (conn.manuallyClosed) return;

    // Only open sockets for connections that are still registered.
    if (this.connections.get(conn.key) !== conn) return;

    conn.opening = true;
    let url = '';
    try {
      url = await this.platform.buildSocketUrl(conn.key);
    } catch {
      url = '';
    } finally {
      conn.opening = false;
    }
    if (!url) return;
    // State may have changed while we awaited the token.
    if (conn.manuallyClosed) return;
    if (this.connections.get(conn.key) !== conn) return;
    if (conn.ws && conn.ws.readyState < SOCKET_CLOSING) return;

    // Detach any stale socket so its late events cannot touch this connection.
    if (conn.ws) this.detachSocket(conn.ws);

    let ws: RealtimeSocket;
    try {
      ws = this.platform.createSocket(url);
    } catch {
      this.scheduleReconnect(conn);
      return;
    }
    conn.ws = ws;

    ws.onopen = () => {
      if (conn.ws !== ws) return;
      conn.connected = true;
      conn.openedOnce = true;
      conn.reconnectAttempt = 0;

      if (conn.user) {
        ws.send(JSON.stringify({ t: 'join', user: conn.user }));
      }

      // Subscriptions are authoritative from local refcounts, so replay them
      // first (the server requires a subscription before accepting a publish),
      // then flush any queued non-subscription frames.
      this.resubscribeConnection(conn);
      for (const frame of conn.pending.splice(0)) {
        if (isSubscriptionFrame(frame)) continue;
        try {
          ws.send(frame);
        } catch {
          /* ignore */
        }
      }

      this.startHeartbeat(conn);
      this.emitGlobalStatus(true);
      // Every open — the first one included — is the signal hooks use to close
      // the gap between "I last fetched" and "events start flowing": nothing
      // published before this moment is guaranteed to be in the socket's buffer,
      // so the API is the only place it can be recovered from.
      this.emitRoomStatus(conn, true);
    };

    ws.onmessage = (event: { data: string | ArrayBuffer }) => {
      if (conn.ws !== ws) return;
      const raw = typeof event.data === 'string' ? event.data : String(event.data);

      // The DO auto-responds to heartbeats without waking from hibernation.
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
        count?: number;
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
      const room =
        msg.room && this.rooms.has(msg.room)
          ? msg.room
          : isCommunityRoom(conn.key)
            ? conn.key
            : msg.room;

      if (msg.t === 'hello') {
        // Connection established
      } else if (msg.t === 'event' && msg.topic && room) {
        this.dispatchToRoom(room, msg.topic, msg.data, msg.sender);
        this.dispatchGlobal(msg.topic, msg.data, msg.sender);
      } else if (msg.t === 'presence' && room) {
        const presence: RealtimePresence = {
          count: typeof msg.count === 'number' && msg.count > 0 ? msg.count : 0,
        };
        this.presenceCache.set(room, presence);
        this.emitRoomPresence(room, presence);
        this.emitGlobalPresence(presence);
      } else if (msg.t === 'error') {
        console.warn('[realtime]', msg.message);
      }
    };

    ws.onclose = () => {
      // Ignore close events from sockets this connection no longer owns.
      if (conn.ws !== ws) return;
      conn.ws = null;
      const wasConnected = conn.connected;
      conn.connected = false;
      this.stopHeartbeat(conn);
      this.emitGlobalStatus(this.isConnected());
      if (wasConnected) this.emitRoomStatus(conn, false);
      if (!conn.manuallyClosed) this.scheduleReconnect(conn);
    };

    ws.onerror = () => {
      /* onclose follows and drives the reconnect */
    };
  }

  private detachSocket(ws: RealtimeSocket): void {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onclose = null;
    ws.onerror = null;
  }

  private scheduleReconnect(conn: ConnectionState): void {
    if (conn.reconnectTimer !== null || conn.manuallyClosed) return;
    if (this.connections.get(conn.key) !== conn) return;
    const delay = Math.min(
      this.reconnectBaseMs * 2 ** conn.reconnectAttempt,
      this.reconnectMaxMs,
    );
    conn.reconnectAttempt += 1;
    conn.reconnectTimer = setTimeout(() => {
      conn.reconnectTimer = null;
      void this.openConnection(conn);
    }, delay);
  }

  // ── Heartbeat ───────────────────────────────────────────────────────

  private startHeartbeat(conn: ConnectionState): void {
    this.stopHeartbeat(conn);
    conn.heartbeatTimer = setInterval(() => this.sendPing(conn), this.heartbeatIntervalMs);
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
    if (!ws || ws.readyState !== SOCKET_OPEN) return;
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
    }, this.heartbeatTimeoutMs);
  }

  /** Force-close a suspected-dead socket and reconnect immediately. */
  private recycleConnection(conn: ConnectionState): void {
    const ws = conn.ws;
    this.stopHeartbeat(conn);
    conn.ws = null;
    const wasConnected = conn.connected;
    conn.connected = false;
    if (ws) {
      this.detachSocket(ws);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.emitGlobalStatus(this.isConnected());
    if (wasConnected) this.emitRoomStatus(conn, false);
    if (conn.manuallyClosed) return;
    if (conn.reconnectTimer !== null) {
      clearTimeout(conn.reconnectTimer);
      conn.reconnectTimer = null;
    }
    conn.reconnectAttempt = 0;
    void this.openConnection(conn);
  }

  /**
   * Replay the desired subscriptions of a freshly opened socket.
   *
   * Community sockets carry exactly one room; the shared user socket carries
   * every user-scoped room, which is why those are replayed by iterating the
   * room table rather than looking up `conn.key` alone.
   */
  private resubscribeConnection(conn: ConnectionState): void {
    const own = this.rooms.get(conn.key);
    if (own) {
      for (const [topic, refCount] of own.topicRefs) {
        if (refCount > 0) {
          this.sendToConnection(conn, { t: 'subscribe', room: conn.key, topic });
        }
      }
    }

    if (!isCommunityRoom(conn.key)) {
      for (const [room, state] of this.rooms) {
        if (isCommunityRoom(room)) continue;
        for (const [topic, refCount] of state.topicRefs) {
          if (refCount > 0) {
            this.sendToConnection(conn, { t: 'subscribe', room, topic });
          }
        }
      }
    }
  }

  /** The connection a room travels over — its own socket, or the shared user socket. */
  private getRoomConnection(room: string): ConnectionState {
    if (isCommunityRoom(room)) {
      return this.getOrCreateConnection(room);
    }
    return this.getOrCreateConnection(this.userSocketKey());
  }

  // ── Subscription management ───────────────────────────────────────────────

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

  subscribe(room: string): () => void {
    this.getOrCreateRoom(room).subscribeRefs += 1;
    const session = this.session;

    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (session !== this.session) return;
      // Read the LIVE room state: a room torn down and re-created (logout →
      // next sign-in) must not have its refcount stolen by an old closure.
      const current = this.rooms.get(room);
      if (!current) return;
      current.subscribeRefs = Math.max(0, current.subscribeRefs - 1);
      this.maybeRemoveRoom(room);
    };
  }

  unsubscribe(room: string): void {
    const state = this.rooms.get(room);
    if (!state) return;

    const conn = this.getRoomConnection(room);
    if (conn.ws && conn.ws.readyState === SOCKET_OPEN) {
      for (const [topic, refCount] of state.topicRefs) {
        if (refCount > 0) {
          this.sendToConnection(conn, { t: 'unsubscribe', room, topic });
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

  on(room: string, topic: string, handler: RealtimeEventHandler): () => void {
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
      this.sendToConnection(conn, { t: 'subscribe', room, topic });
      // Ensure connection is open
      if (!conn.ws || conn.ws.readyState >= SOCKET_CLOSING) {
        void this.openConnection(conn);
      }
    }

    // Return cleanup function
    const session = this.session;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (session !== this.session) return;
      const current = this.rooms.get(room);
      if (!current) return;
      const handlers = current.topicHandlers.get(topic);
      if (handlers) handlers.delete(handler);
      const refs = current.topicRefs.get(topic) ?? 0;
      if (refs <= 1) {
        // Last handler removed — unsubscribe from server
        current.topicRefs.delete(topic);
        current.topicHandlers.delete(topic);
        const conn = this.connections.get(this.connectionKeyFor(room));
        if (conn && conn.ws && conn.ws.readyState === SOCKET_OPEN) {
          this.sendToConnection(conn, { t: 'unsubscribe', room, topic });
        }
      } else {
        current.topicRefs.set(topic, refs - 1);
      }
      this.maybeRemoveRoom(room);
    };
  }

  off(room: string, topic: string, handler: RealtimeEventHandler): void {
    const state = this.rooms.get(room);
    if (!state) return;
    const topicSet = state.topicHandlers.get(topic);
    if (topicSet) topicSet.delete(handler);
  }

  onPresence(room: string, handler: RealtimePresenceHandler): () => void {
    const state = this.getOrCreateRoom(room);
    state.presenceHandlers.add(handler);

    const cached = this.presenceCache.get(room);
    if (cached) {
      try {
        handler(cached);
      } catch {
        /* ignore */
      }
    }

    const session = this.session;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (session !== this.session) return;
      const current = this.rooms.get(room);
      if (!current) return;
      current.presenceHandlers.delete(handler);
      this.maybeRemoveRoom(room);
    };
  }

  onStatus(handler: RealtimeStatusHandler): () => void {
    this.globalStatusHandlers.add(handler);
    const session = this.session;
    return () => {
      if (session !== this.session) return;
      this.globalStatusHandlers.delete(handler);
    };
  }

  /**
   * Room-scoped connection status — fires `true` when this room's socket comes
   * up (a re-open after a drop included) and `false` when it drops.
   *
   * Hooks use the `true` edge to catch up on what was published while the
   * socket was down: the queue only ever replays *desired* subscriptions, so
   * anything broadcast during a gap is otherwise invisible until the screen is
   * remounted. A subscribed socket receives everything published after this
   * point, so closing the gap once per open is enough.
   */
  onRoomStatus(room: string, handler: RealtimeStatusHandler): () => void {
    const key = this.connectionKeyFor(room);
    let handlers = this.roomStatusHandlers.get(key);
    if (!handlers) {
      handlers = new Set();
      this.roomStatusHandlers.set(key, handlers);
    }
    handlers.add(handler);

    const session = this.session;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (session !== this.session) return;
      const current = this.roomStatusHandlers.get(key);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) this.roomStatusHandlers.delete(key);
    };
  }

  // ── Publishing ────────────────────────────────────────────────────────────

  publish(room: string, topic: string, data: unknown): void {
    const conn = this.getRoomConnection(room);
    // A publish is a live interaction: never let a previous close() keep the
    // socket down for a room that is being used again.
    conn.manuallyClosed = false;
    this.sendToConnection(conn, { t: 'publish', room, topic, data });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Close every socket and cancel its reconnect, keeping the subscription
   * table so a later `connect()` can bring the same rooms back.
   *
   * Marking a connection closed *before* closing the socket is what stops a
   * late `onclose` from scheduling a reconnect.
   */
  close(): void {
    for (const [, conn] of this.connections) {
      this.teardownConnection(conn, { keepUser: true });
    }
    this.emitGlobalStatus(false);
  }

  /**
   * Full session teardown — closes and forgets every socket, drops the
   * subscription table, queued frames, presence cache and handlers, and clears
   * the identity.
   *
   * This is what logout/account switch must call: anything still held here
   * (a reconnect timer, a queued frame, a `join` identity) belongs to the
   * account that just left and must not be reachable from the next session.
   */
  destroy(): void {
    this.close();
    // Every closure captured before this line belongs to the account that just
    // left; re-open the session counter so they can no longer touch this client.
    this.session += 1;
    this.rooms.clear();
    this.presenceCache.clear();
    this.globalEvents.clear();
    this.globalPresenceHandlers.clear();
    this.globalStatusHandlers.clear();
    this.roomStatusHandlers.clear();
    this.connections.clear();
    this.user = null;
  }

  isConnected(): boolean {
    for (const [, conn] of this.connections) {
      if (conn.connected) return true;
    }
    return false;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /** Socket key a room travels over — a room name, or the user socket key. */
  private connectionKeyFor(room: string): string {
    return isCommunityRoom(room) ? room : this.userSocketKey();
  }

  /**
   * Stop everything a connection owns: reconnect timer, heartbeat, queued
   * frames and the live socket. `manuallyClosed` is set first so a late
   * `onclose` cannot schedule a reconnect behind us.
   */
  private teardownConnection(conn: ConnectionState, { keepUser }: { keepUser: boolean }): void {
    conn.manuallyClosed = true;
    if (conn.reconnectTimer !== null) {
      clearTimeout(conn.reconnectTimer);
      conn.reconnectTimer = null;
    }
    this.stopHeartbeat(conn);
    conn.pending = [];
    if (conn.ws) {
      this.detachSocket(conn.ws);
      try {
        conn.ws.close();
      } catch {
        /* ignore */
      }
      conn.ws = null;
    }
    const wasConnected = conn.connected;
    conn.connected = false;
    conn.opening = false;
    if (!keepUser) conn.user = null;
    if (wasConnected) this.emitRoomStatus(conn, false);
  }

  /**
   * Remove a room from the map if it has no active handlers, no subscribe()
   * callers and no presence handlers.
   */
  private maybeRemoveRoom(room: string): void {
    const state = this.rooms.get(room);
    if (!state) return;
    const hasHandlers = state.topicRefs.size > 0;
    if (!hasHandlers && state.subscribeRefs === 0 && state.presenceHandlers.size === 0) {
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

    // No other rooms — close and remove. Room-status handlers are left to
    // their own unsubscribe: dropping a live one here would leave a mounted
    // hook that no longer hears about reconnects.
    this.teardownConnection(conn, { keepUser: false });
    this.connections.delete(room);
  }

  private sendToConnection(conn: ConnectionState, msg: unknown): void {
    const json = JSON.stringify(msg);
    if (conn.ws && conn.ws.readyState === SOCKET_OPEN) {
      try {
        conn.ws.send(json);
        return;
      } catch {
        /* fall through to queue */
      }
    }
    conn.pending.push(json);
  }

  private dispatchToRoom(
    room: string,
    topic: string,
    data: unknown,
    sender?: string,
  ): void {
    const state = this.rooms.get(room);
    if (!state) return;
    const handlers = state.topicHandlers.get(topic);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(data, sender);
      } catch (error) {
        console.error('[realtime] event handler error', error);
      }
    }
  }

  private dispatchGlobal(topic: string, data: unknown, sender?: string): void {
    const handlers = this.globalEvents.get(topic);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(data, sender);
      } catch (error) {
        console.error('[realtime] global event handler error', error);
      }
    }
  }

  private emitRoomPresence(room: string, presence: RealtimePresence): void {
    const state = this.rooms.get(room);
    if (!state) return;
    for (const handler of state.presenceHandlers) {
      try {
        handler(presence);
      } catch (error) {
        console.error('[realtime] presence handler error', error);
      }
    }
  }

  private emitGlobalPresence(presence: RealtimePresence): void {
    for (const handler of this.globalPresenceHandlers) {
      try {
        handler(presence);
      } catch (error) {
        console.error('[realtime] global presence handler error', error);
      }
    }
  }

  private emitRoomStatus(conn: ConnectionState, connected: boolean): void {
    const handlers = this.roomStatusHandlers.get(conn.key);
    if (!handlers) return;
    for (const handler of [...handlers]) {
      try {
        handler(connected);
      } catch (error) {
        console.error('[realtime] room status handler error', error);
      }
    }
  }

  private emitGlobalStatus(connected: boolean): void {
    for (const handler of this.globalStatusHandlers) {
      try {
        handler(connected);
      } catch (error) {
        console.error('[realtime] status handler error', error);
      }
    }
  }
}

/**
 * True for a frame whose effect the local refcounts already own, so replaying it
 * from the stale queue after a reconnect would fight them.
 *
 * `resubscribeConnection` re-sends every subscription that is still wanted, so a
 * queued `subscribe` is redundant and a queued `unsubscribe` is *dangerous*: it
 * was decided while the socket was down, and flushing it after the replay would
 * cancel a subscription another screen still holds.
 */
export function isSubscriptionFrame(frame: string): boolean {
  try {
    const parsed = JSON.parse(frame) as { t?: string };
    return parsed.t === 'subscribe' || parsed.t === 'unsubscribe';
  } catch {
    return false;
  }
}
