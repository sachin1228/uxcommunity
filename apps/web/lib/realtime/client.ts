"use client";

/**
 * Singleton browser client for the Cloudflare realtime service.
 *
 * Architecture:
 *   Component → realtimeClient (singleton) → 1 WebSocket → UserDO → Community DOs
 *
 * Reference-counted subscriptions:
 *   Each room tracks:
 *     - topicRefs: refcount per topic (how many on() calls)
 *     - subscribed: whether subscribe() was called
 *   Room is only cleaned up when BOTH topicRefs reach 0 AND subscribed is false.
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

function buildWebSocketUrl(baseUrl: string, userId: string): string {
  if (!baseUrl) {
    return `/ws?room=user:${encodeURIComponent(userId)}`;
  }
  const wsBase = baseUrl.replace(/^http/, "ws");
  return `${wsBase}/ws?room=user:${encodeURIComponent(userId)}`;
}

interface RoomState {
  room: string;
  /** Reference count per topic — incremented by on(), decremented by returned cleanup. */
  topicRefs: Map<string, number>;
  /** Actual handler sets per topic. */
  topicHandlers: Map<string, Set<EventHandler>>;
  presenceHandlers: Set<PresenceHandler>;
  /** Whether subscribe() was called for this room. */
  subscribed: boolean;
}

/**
 * Singleton RealtimeClient — one per browser session.
 *
 * Maintains ONE WebSocket to the UserDO. Components subscribe to logical
 * rooms and topics; the UserDO handles routing to community DOs.
 *
 * Reference-counted lifecycle:
 *   on(room, topic, handler)  → increments topic refcount, subscribes if first
 *   returned cleanup()        → decrements refcount, unsubscribes if last
 *   subscribe(room)           → marks room as desired
 *   returned cleanup()        → marks room as undesired, removes if no handlers
 *
 * Room is only removed when BOTH:
 *   - All topic refcounts are 0 (no handlers)
 *   - subscribed === false (no subscribe() callers)
 */
class RealtimeClient {
  private ws: WebSocket | null = null;
  private user: RealtimeUser | null = null;
  private userId: string | null = null;
  private manuallyClosed = false;
  private connected = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: string[] = [];

  /** roomName → room state */
  private rooms = new Map<string, RoomState>();

  private globalEvents = new Map<string, Set<EventHandler>>();
  private globalPresenceHandlers = new Set<PresenceHandler>();
  private globalStatusHandlers = new Set<StatusHandler>();
  private presenceCache = new Map<string, RealtimePresenceUser[]>();

  init(user: RealtimeUser): void {
    if (!this.user) {
      this.user = user;
      this.userId = user.id;
    }
  }

  connect(): void {
    this.manuallyClosed = false;
    this.open();
  }

  private open(): void {
    if (this.ws && this.ws.readyState < WebSocket.CLOSING) return;
    if (!this.userId) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(buildWebSocketUrl(REALTIME_URL, this.userId));
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempt = 0;
      this.emitGlobalStatus(true);

      if (this.user) {
        ws.send(JSON.stringify({ t: "join", user: this.user }));
      }

      for (const msg of this.pending.splice(0)) ws.send(msg);
      this.resubscribeAll();
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
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (msg.t === "hello") {
        // Connection established
      } else if (msg.t === "event" && msg.topic && msg.room) {
        this.dispatchToRoom(msg.room, msg.topic, msg.data, msg.sender);
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

    ws.onclose = () => {
      this.connected = false;
      this.emitGlobalStatus(false);
      if (!this.manuallyClosed) this.scheduleReconnect();
    };

    ws.onerror = () => {};
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer !== null || this.manuallyClosed) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  /**
   * Resubscribe all rooms that have active handlers or are marked as subscribed.
   * Called after WebSocket reconnect.
   */
  private resubscribeAll(): void {
    for (const [roomName, state] of this.rooms) {
      const hasHandlers = state.topicRefs.size > 0;
      if (state.subscribed || hasHandlers) {
        for (const [topic, refCount] of state.topicRefs) {
          if (refCount > 0) {
            this.sendTopicSubscribe(roomName, topic);
          }
        }
      }
    }
  }

  // ── Subscription management (reference-counted) ──────────────────────────

  /**
   * Mark a room as desired. Does NOT create subscriptions by itself.
   * Pair with on() to subscribe to specific topics.
   * Returns an unsubscribe function that cleans up when ALL users are done.
   */
  subscribe(room: string): () => void {
    const state = this.getOrCreateRoom(room);
    state.subscribed = true;
    return () => {
      state.subscribed = false;
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

    // Send unsubscribe for all topics with active handlers
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      for (const [topic, refCount] of state.topicRefs) {
        if (refCount > 0) {
          this.sendToWs({ t: "unsubscribe", room, topic });
        }
      }
    }

    state.topicRefs.clear();
    state.topicHandlers.clear();
    state.presenceHandlers.clear();
    state.subscribed = false;
    this.rooms.delete(room);
    this.presenceCache.delete(room);
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
      this.sendTopicSubscribe(room, topic);
    }

    // Return cleanup function
    return () => {
      topicSet!.delete(handler);
      const current = state.topicRefs.get(topic) ?? 0;
      if (current <= 1) {
        // Last handler removed — unsubscribe from server
        state.topicRefs.delete(topic);
        state.topicHandlers.delete(topic);
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.sendToWs({ t: "unsubscribe", room, topic });
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
    this.sendToWs({ t: "publish", room, topic, data });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  close(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.pending = [];
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this.connected = false;
    this.emitGlobalStatus(false);
  }

  destroy(): void {
    this.close();
    this.rooms.clear();
    this.presenceCache.clear();
    this.globalEvents.clear();
    this.globalPresenceHandlers.clear();
    this.globalStatusHandlers.clear();
    this.user = null;
    this.userId = null;
  }

  isConnected(): boolean {
    return this.connected;
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
        subscribed: false,
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
    if (!state.subscribed && !hasHandlers && state.presenceHandlers.size === 0) {
      this.rooms.delete(room);
      this.presenceCache.delete(room);
    }
  }

  private sendTopicSubscribe(room: string, topic: string): void {
    this.sendToWs({ t: "subscribe", room, topic });
  }

  private sendToWs(msg: unknown): void {
    const json = JSON.stringify(msg);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(json);
    } else {
      this.pending.push(json);
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
 * One client = one WebSocket to UserDO = all logical room subscriptions.
 */
export const realtimeClient = new RealtimeClient();
