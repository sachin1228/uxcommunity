"use client";

/**
 * Singleton browser client for the Cloudflare realtime service.
 *
 * Architecture:
 *   Component → realtimeClient (singleton) → N WebSockets → CommunityDOs
 *   Each community-scoped room (chat:*, threads:*, etc.) gets its own
 *   WebSocket directly to the CommunityDO. User-scoped rooms (notifications:*)
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
 * Liveness: see socket/heartbeat.ts. Socket lifecycle (open, backoff,
 * teardown, frame queue) lives in socket/connection-pool.ts; this file owns
 * rooms, topics, presence and handler dispatch.
 */

import { ConnectionPool } from "./socket/connection-pool";
import { RoomRegistry } from "./socket/room-registry";
import {
  applyPresenceDelta,
  onTabResume,
  resolveFrameRoom,
  subscriptionsForConnection,
  wantsUserSocket,
} from "./socket/routing";
import {
  invokeAll,
  isCommunityRoom,
  type ConnectionState,
  type EventHandler,
  type InboundFrame,
  type PresenceHandler,
  type RealtimeUser,
  type StatusHandler,
} from "./socket/protocol";

export type { RealtimePresenceUser, RealtimeUser } from "./socket/protocol";

class RealtimeClient {
  private registry = new RoomRegistry((room) => this.maybeRemoveConnection(room));
  private globalEvents = new Map<string, Set<EventHandler>>();
  private globalStatusHandlers = new Set<StatusHandler>();

  private sessionToken: string | null = null;
  /** Identity persisted across connections so sockets created later still send `join`. */
  private user: RealtimeUser | null = null;
  private lifecycleBound = false;

  private pool = new ConnectionPool({
    getUser: () => this.user,
    getSessionToken: () => this.sessionToken,
    resubscribe: (conn) => this.resubscribeConnection(conn),
    onFrame: (conn, frame) => this.handleFrame(conn, frame),
    onStatus: (connected) => this.emitGlobalStatus(connected),
  });

  /** Exposed (privately) for the isolation tests, which inspect it by name. */
  private get connections(): Map<string, ConnectionState> {
    return this.pool.connections;
  }

  init(user: RealtimeUser): void {
    const previousKey = this.userConnectionKey();
    this.user = user;

    // The user-scoped socket is addressed by user id, and the server publishes
    // user-scoped rooms to `user:${userId}`. If identity arrives (or changes)
    // after such a socket already exists under the previous key, re-key it —
    // otherwise this browser sits on a DO nobody publishes to and user-scoped
    // events are silently dropped.
    const nextKey = this.userConnectionKey();
    if (previousKey !== nextKey) this.migrateConnection(previousKey, nextKey);

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
    for (const [, conn] of this.connections) {
      conn.manuallyClosed = false;
      if (!conn.ws || conn.ws.readyState >= WebSocket.CLOSING) {
        this.pool.open(conn);
      }
    }
  }

  // ── Subscription management (reference-counted) ──────────────────────────

  /**
   * Mark a room as desired. Does NOT create subscriptions by itself.
   * Pair with on() to subscribe to specific topics.
   * Returns an idempotent release function; the room is only torn down when
   * every subscribe() caller has released AND no handlers remain.
   */
  subscribe(room: string): () => void {
    this.registry.getOrCreate(room).subscribeRefs += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.registry.rooms.get(room);
      if (!current) return;
      current.subscribeRefs = Math.max(0, current.subscribeRefs - 1);
      this.registry.removeIfIdle(room);
    };
  }

  /**
   * @deprecated Use the ref-counted on()/subscribe() pattern instead.
   * This method forcefully removes a room. Only use if you are the sole consumer.
   */
  unsubscribe(room: string): void {
    const state = this.registry.rooms.get(room);
    if (!state) return;

    const conn = this.getRoomConnection(room);
    if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
      for (const [topic, refCount] of state.topicRefs) {
        if (refCount > 0) this.pool.send(conn, { t: "unsubscribe", room, topic });
      }
    }
    this.registry.forceRemove(room);
  }

  /**
   * Register an event handler for a specific room + topic.
   * Reference-counted: the topic subscription stays active as long as
   * at least one handler is registered. Returns a cleanup function.
   */
  on(room: string, topic: string, handler: EventHandler): () => void {
    const state = this.registry.getOrCreate(room);
    const { first, handlers } = this.registry.addTopicHandler(state, topic, handler);

    // First handler for this topic — tell the server.
    if (first) {
      const conn = this.getRoomConnection(room);
      conn.manuallyClosed = false;
      this.pool.send(conn, { t: "subscribe", room, topic });
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.registry.removeTopicHandler(state, handlers, topic, handler)) {
        // Last handler removed — unsubscribe from server
        const conn = this.pool.get(isCommunityRoom(room) ? room : this.userConnectionKey());
        if (conn?.ws && conn.ws.readyState === WebSocket.OPEN) {
          this.pool.send(conn, { t: "unsubscribe", room, topic });
        }
      }
      this.registry.removeIfIdle(room);
    };
  }

  off(room: string, topic: string, handler: EventHandler): void {
    this.registry.rooms.get(room)?.topicHandlers.get(topic)?.delete(handler);
  }

  onPresence(room: string, handler: PresenceHandler): () => void {
    const state = this.registry.getOrCreate(room);
    this.getRoomConnection(room);
    state.presenceHandlers.add(handler);

    const cached = this.registry.cachedPresence(room);
    if (cached) {
      try { handler(cached); } catch { /* ignore */ }
    }

    let released = false;
    return () => {
      if (released) return;
      released = true;
      state.presenceHandlers.delete(handler);
      this.registry.removeIfIdle(room);
    };
  }

  onStatus(handler: StatusHandler): () => void {
    this.globalStatusHandlers.add(handler);
    return () => {
      this.globalStatusHandlers.delete(handler);
    };
  }

  publish(room: string, topic: string, data: unknown): void {
    const conn = this.getRoomConnection(room);
    conn.manuallyClosed = false;
    this.pool.send(conn, { t: "publish", room, topic, data });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  close(): void {
    for (const [, conn] of this.connections) this.pool.shutdown(conn);
    this.emitGlobalStatus(false);
  }

  destroy(): void {
    this.close();
    this.registry.clear();
    this.globalEvents.clear();
    this.globalStatusHandlers.clear();
    this.pool.clear();
  }

  isConnected(): boolean {
    return this.pool.isConnected();
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /** Connection key for every non-community (user-scoped) room. */
  private userConnectionKey(): string {
    return this.user ? `user:${this.user.id}` : "user:global";
  }

  /**
   * Move a user-scoped socket to a new connection key, replaying its local
   * subscriptions on the replacement socket.
   */
  private migrateConnection(fromKey: string, toKey: string): void {
    if (!this.pool.get(fromKey)) return;
    this.pool.remove(fromKey);

    // Something still wanted a user socket — bring one up under the new key.
    if (wantsUserSocket(this.registry.rooms)) {
      const next = this.pool.getOrCreate(toKey);
      next.user = this.user;
      next.manuallyClosed = false;
      this.pool.open(next);
    }
  }

  private bindLifecycle(): void {
    if (this.lifecycleBound || typeof window === "undefined") return;
    this.lifecycleBound = true;
    onTabResume(() => {
      for (const [, conn] of this.connections) this.pool.probe(conn);
    });
  }

  private handleFrame(conn: ConnectionState, msg: InboundFrame): void {
    const room = resolveFrameRoom(this.registry.rooms, conn, msg);

    if (msg.t === "event" && msg.topic && room) {
      this.registry.dispatch(room, msg.topic, msg.data, msg.sender);
      invokeAll(this.globalEvents.get(msg.topic), [msg.data, msg.sender], "global event handler");
    } else if (msg.t === "presence" && room) {
      this.registry.setPresence(room, msg.users ?? []);
    } else if (msg.t === "presence_delta" && room) {
      this.registry.setPresence(room, applyPresenceDelta(this.registry.cachedPresence(room) ?? [], msg));
    } else if (msg.t === "error") {
      console.warn("[realtime]", msg.message);
    }
  }

  private resubscribeConnection(conn: ConnectionState): void {
    for (const { room, topic } of subscriptionsForConnection(this.registry.rooms, conn.key)) {
      this.pool.send(conn, { t: "subscribe", room, topic });
    }
  }

  private getRoomConnection(room: string): ConnectionState {
    // Community-scoped rooms get their own connection keyed by room name.
    // Every user-scoped room is multiplexed over one socket to that user's
    // UserDO — the same instance the server publishes `notifications:${userId}` to.
    return this.pool.getOrCreate(isCommunityRoom(room) ? room : this.userConnectionKey());
  }

  private maybeRemoveConnection(room: string): void {
    if (isCommunityRoom(room)) this.pool.remove(room);
  }

  private emitGlobalStatus(connected: boolean): void {
    invokeAll(this.globalStatusHandlers, [connected], "status handler");
  }
}

/**
 * Singleton RealtimeClient shared across the entire app.
 * Manages multiple WebSockets — one per community + one for user rooms.
 */
export const realtimeClient = new RealtimeClient();
