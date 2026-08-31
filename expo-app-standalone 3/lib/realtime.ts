/**
 * Cloudflare Realtime client for React Native / Expo.
 *
 * Singleton multiplexed client — one WebSocket to UserDO, multiple logical rooms.
 * Each room supports multiple logical topics (chat, typing, presence, etc.).
 *
 * Architecture:
 *   Hook → realtimeClient (singleton) → 1 WebSocket → UserDO → Community DOs
 *
 * Authentication: passes the session JWT as a query parameter since React
 * Native's WebSocket API does not support custom headers.
 *
 * Requires in .env:
 *   EXPO_PUBLIC_REALTIME_URL=wss://rt.uxcommunity.in
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const REALTIME_URL = process.env.EXPO_PUBLIC_REALTIME_URL ?? '';
const SESSION_STORAGE_KEY = '@auth/uxcommunity_session';

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;

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

/**
 * Build a WebSocket URL pointing at the UserDO.
 * Passes the session token as a query parameter for authentication.
 */
async function buildWebSocketUrl(userId: string): Promise<string> {
  const token = await AsyncStorage.getItem(SESSION_STORAGE_KEY).catch(() => null);
  const base = REALTIME_URL || '';
  if (!base) {
    console.warn('[realtime] EXPO_PUBLIC_REALTIME_URL is not set');
    return '';
  }
  const wsBase = base.replace(/^http/, 'ws');
  const params = new URLSearchParams({ room: `user:${userId}` });
  if (token) params.set('token', token);
  return `${wsBase}/ws?${params.toString()}`;
}

interface RoomState {
  room: string;
  topics: Map<string, Set<EventHandler>>;
  presenceHandlers: Set<PresenceHandler>;
}

/**
 * Singleton RealtimeClient — one per app session.
 *
 * Maintains ONE WebSocket to the UserDO. Hooks subscribe to logical
 * rooms and topics; the UserDO routes to community DOs.
 *
 * Uses ref-counted subscriptions so multiple hooks can subscribe to the
 * same room/topic without interfering with each other. Server unsubscribe
 * is only sent when the last handler for a topic is removed, and room
 * cleanup only happens when the last topic's refcount hits zero.
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

  private rooms = new Map<string, RoomState>();
  /** Per-room refcount — how many topics in this room have active handlers. */
  private roomRefs = new Map<string, number>();
  /** Per-topic refcount — `room:topic` → number of active handlers. */
  private topicRefs = new Map<string, number>();
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

  private async open(): Promise<void> {
    if (this.ws && this.ws.readyState < WebSocket.CLOSING) return;
    if (!this.userId) return;

    const url = await buildWebSocketUrl(this.userId);
    if (!url) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
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
        ws.send(JSON.stringify({ t: 'join', user: this.user }));
      }

      for (const msg of this.pending.splice(0)) ws.send(msg);
      this.resubscribeAll();
    };

    ws.onmessage = (event: { data: string | ArrayBuffer }) => {
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
        msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      } catch {
        return;
      }

      if (msg.t === 'hello') {
        // Connection established
      } else if (msg.t === 'event' && msg.topic && msg.room) {
        this.dispatchToRoom(msg.room, msg.topic, msg.data, msg.sender);
        this.dispatchGlobal(msg.topic, msg.data, msg.sender);
      } else if (msg.t === 'presence' && msg.room) {
        this.presenceCache.set(msg.room, msg.users ?? []);
        this.emitRoomPresence(msg.room, msg.users ?? []);
        this.emitGlobalPresence(msg.users ?? []);
      } else if (msg.t === 'presence_delta' && msg.room) {
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
      } else if (msg.t === 'error') {
        console.warn('[realtime]', msg.message);
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

  private resubscribeAll(): void {
    for (const [roomName, state] of this.rooms) {
      if ((this.roomRefs.get(roomName) ?? 0) > 0) {
        for (const topic of state.topics.keys()) {
          this.sendTopicSubscribe(roomName, topic);
        }
      }
    }
  }

  // ── Subscription management (ref-counted) ───────────────────────────────

  private ensureRoom(room: string): RoomState {
    if (!this.rooms.has(room)) {
      this.rooms.set(room, {
        room,
        topics: new Map(),
        presenceHandlers: new Set(),
      });
    }
    return this.rooms.get(room)!;
  }

  private topicKey(room: string, topic: string): string {
    return `${room}::${topic}`;
  }

  /**
   * Subscribe to a room. Increments room refcount.
   * Returns an unsubscribe function — call it when the subscriber is done.
   */
  subscribe(room: string): () => void {
    this.ensureRoom(room);
    this.roomRefs.set(room, (this.roomRefs.get(room) ?? 0) + 1);
    return () => this.unsubscribe(room);
  }

  /**
   * Unsubscribe from a room. Decrements room refcount; when it hits zero,
   * removes the room from the map and sends unsubscribe for all topics.
   */
  unsubscribe(room: string): void {
    const refs = (this.roomRefs.get(room) ?? 1) - 1;
    if (refs <= 0) {
      this.roomRefs.delete(room);
      const state = this.rooms.get(room);
      this.rooms.delete(room);
      this.presenceCache.delete(room);
      if (state && this.ws && this.ws.readyState === WebSocket.OPEN) {
        for (const topic of state.topics.keys()) {
          this.sendToWs({ t: 'unsubscribe', room, topic });
          this.topicRefs.delete(this.topicKey(room, topic));
        }
      }
    } else {
      this.roomRefs.set(room, refs);
    }
  }

  /**
   * Register an event handler for a room+topic. Automatically subscribes to
   * the room if not already subscribed. Sends server subscribe on the first
   * handler for a given topic.
   *
   * Returns a cleanup function that removes the handler. When the last
   * handler for a topic is removed, sends server unsubscribe.
   */
  on(room: string, topic: string, handler: EventHandler): () => void {
    const state = this.ensureRoom(room);
    this.roomRefs.set(room, (this.roomRefs.get(room) ?? 0) + 1);

    let topicSet = state.topics.get(topic);
    if (!topicSet) {
      topicSet = new Set();
      state.topics.set(topic, topicSet);
    }

    const key = this.topicKey(room, topic);
    const wasEmpty = topicSet.size === 0;
    topicSet.add(handler);
    this.topicRefs.set(key, (this.topicRefs.get(key) ?? 0) + 1);

    if (wasEmpty) {
      this.sendTopicSubscribe(room, topic);
    }

    return () => {
      topicSet!.delete(handler);
      const refs = (this.topicRefs.get(key) ?? 1) - 1;
      if (refs <= 0) {
        this.topicRefs.delete(key);
        this.sendToWs({ t: 'unsubscribe', room, topic });
      } else {
        this.topicRefs.set(key, refs);
      }
    };
  }

  off(room: string, topic: string, handler: EventHandler): void {
    const state = this.rooms.get(room);
    if (!state) return;
    const topicSet = state.topics.get(topic);
    if (topicSet) topicSet.delete(handler);
  }

  onPresence(room: string, handler: PresenceHandler): () => void {
    const state = this.ensureRoom(room);
    state.presenceHandlers.add(handler);

    const cached = this.presenceCache.get(room);
    if (cached) {
      try { handler(cached); } catch { /* ignore */ }
    }

    return () => {
      state!.presenceHandlers.delete(handler);
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
    this.sendToWs({ t: 'publish', room, topic, data });
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
    this.roomRefs.clear();
    this.topicRefs.clear();
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

  private sendTopicSubscribe(room: string, topic: string): void {
    this.sendToWs({ t: 'subscribe', room, topic });
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
    const handlers = state.topics.get(topic);
    if (!handlers) return;
    for (const handler of handlers) {
      try { handler(data, sender); } catch (error) {
        console.error('[realtime] event handler error', error);
      }
    }
  }

  private dispatchGlobal(topic: string, data: unknown, sender?: string): void {
    const handlers = this.globalEvents.get(topic);
    if (!handlers) return;
    for (const handler of handlers) {
      try { handler(data, sender); } catch (error) {
        console.error('[realtime] global event handler error', error);
      }
    }
  }

  private emitRoomPresence(room: string, users: RealtimePresenceUser[]): void {
    const state = this.rooms.get(room);
    if (!state) return;
    for (const handler of state.presenceHandlers) {
      try { handler(users); } catch (error) {
        console.error('[realtime] presence handler error', error);
      }
    }
  }

  private emitGlobalPresence(users: RealtimePresenceUser[]): void {
    for (const handler of this.globalPresenceHandlers) {
      try { handler(users); } catch (error) {
        console.error('[realtime] global presence handler error', error);
      }
    }
  }

  private emitGlobalStatus(connected: boolean): void {
    for (const handler of this.globalStatusHandlers) {
      try { handler(connected); } catch (error) {
        console.error('[realtime] status handler error', error);
      }
    }
  }
}

/**
 * Singleton RealtimeClient — one WebSocket to UserDO, all logical room subscriptions.
 */
export const realtimeClient = new RealtimeClient();

/**
 * Room name helpers — matches the web app's rooms.ts.
 */
export const realtimeRooms = {
  chat: (communityId: string) => `chat:${communityId}`,
  presence: (communityId: string) => `presence:${communityId}`,
  threads: (communityId: string) => `threads:${communityId}`,
  events: (communityId: string) => `events:${communityId}`,
  resources: (communityId: string) => `resources:${communityId}`,
} as const;
