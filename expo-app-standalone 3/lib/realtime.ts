/**
 * Cloudflare Realtime client for React Native / Expo.
 *
 * Singleton multiplexed client — one WebSocket, multiple logical rooms.
 * Each room supports multiple logical topics (chat, typing, presence, etc.).
 *
 * Architecture:
 *   Hook → realtimeClient (singleton) → 1 WebSocket → Room DO
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
 * Build a WebSocket URL for the realtime service. Passes the session token
 * as a query parameter for authentication (React Native cannot set cookies
 * on WebSocket handshakes).
 */
async function buildWebSocketUrl(room: string): Promise<string> {
  const token = await AsyncStorage.getItem(SESSION_STORAGE_KEY).catch(() => null);
  const base = REALTIME_URL || '';
  if (!base) {
    console.warn('[realtime] EXPO_PUBLIC_REALTIME_URL is not set');
    return '';
  }
  const wsBase = base.replace(/^http/, 'ws');
  const params = new URLSearchParams({ room });
  if (token) params.set('token', token);
  return `${wsBase}/ws?${params.toString()}`;
}

/**
 * Per-room state tracked by the singleton client.
 */
interface RoomState {
  room: string;
  topics: Map<string, Set<EventHandler>>;
  presenceHandlers: Set<PresenceHandler>;
  subscribed: boolean;
}

/**
 * Multiplexed RealtimeClient — singleton per app session.
 *
 * Maintains ONE WebSocket connection. Hooks subscribe to logical rooms
 * and topics; the Worker/DO handles routing.
 *
 * Usage:
 *   realtimeClient.init(user);
 *   realtimeClient.connect('chat:community123');
 *   realtimeClient.subscribe('chat:community123');
 *   realtimeClient.on('chat:community123', 'message', handler);
 *   realtimeClient.publish('chat:community123', 'typing', { ... });
 *   realtimeClient.unsubscribe('chat:community123');
 */
class RealtimeClient {
  private ws: WebSocket | null = null;
  private activeRoom: string | null = null;
  private user: RealtimeUser | null = null;
  private manuallyClosed = false;
  private connected = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: string[] = [];

  /** roomName → room state */
  private rooms = new Map<string, RoomState>();

  /** Global handlers (backward compat) */
  private globalEvents = new Map<string, Set<EventHandler>>();
  private globalPresenceHandlers = new Set<PresenceHandler>();
  private globalStatusHandlers = new Set<StatusHandler>();

  /** Presence cache per room */
  private presenceCache = new Map<string, RealtimePresenceUser[]>();

  /**
   * Initialize with the current user. Called once on app mount.
   */
  init(user: RealtimeUser): void {
    if (!this.user) this.user = user;
  }

  /**
   * Connect the WebSocket. Safe to call multiple times.
   * The room parameter determines which DO to connect to.
   */
  connect(room?: string): void {
    if (room) this.activeRoom = room;
    this.manuallyClosed = false;
    this.open();
  }

  private async open(): Promise<void> {
    if (this.ws && this.ws.readyState < WebSocket.CLOSING) return;
    if (!this.activeRoom) return;

    const url = await buildWebSocketUrl(this.activeRoom);
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

      // Send join identity
      if (this.user) {
        ws.send(JSON.stringify({ t: 'join', user: this.user }));
      }

      // Flush pending messages
      for (const msg of this.pending.splice(0)) ws.send(msg);

      // Re-subscribe to all rooms
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
      } else if (msg.t === 'event' && msg.topic) {
        const eventRoom = msg.room ?? this.activeRoom ?? '';
        this.dispatchToRoom(eventRoom, msg.topic, msg.data, msg.sender);
        this.dispatchGlobal(msg.topic, msg.data, msg.sender);
      } else if (msg.t === 'presence') {
        const presRoom = msg.room ?? this.activeRoom ?? '';
        this.presenceCache.set(presRoom, msg.users ?? []);
        this.emitRoomPresence(presRoom, msg.users ?? []);
        this.emitGlobalPresence(msg.users ?? []);
      } else if (msg.t === 'presence_delta') {
        const presRoom = msg.room ?? this.activeRoom ?? '';
        const cached = this.presenceCache.get(presRoom) ?? [];
        let updated: RealtimePresenceUser[];
        if (msg.joined) {
          updated = [...cached.filter((u) => u.id !== msg.joined!.id), msg.joined];
        } else if (msg.left) {
          updated = cached.filter((u) => u.id !== msg.left!.id);
        } else {
          updated = cached;
        }
        this.presenceCache.set(presRoom, updated);
        this.emitRoomPresence(presRoom, updated);
        this.emitGlobalPresence(updated);
      } else if (msg.t === 'error') {
        console.warn('[realtime]', msg.message);
      }
    };

    ws.onclose = () => {
      this.connected = false;
      this.emitGlobalStatus(false);
      if (!this.manuallyClosed && this.reconnectEnabled()) this.scheduleReconnect();
    };

    ws.onerror = () => {};
  }

  private reconnectEnabled(): boolean {
    return true;
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
      if (state.subscribed) this.sendSubscribe(roomName);
      for (const topic of state.topics.keys()) {
        this.sendTopicSubscribe(roomName, topic);
      }
    }
  }

  // ── Subscription management ───────────────────────────────────────────────

  /**
   * Subscribe to a room on the server. Returns an unsubscribe function.
   */
  subscribe(room: string): () => void {
    if (!this.rooms.has(room)) {
      this.rooms.set(room, {
        room,
        topics: new Map(),
        presenceHandlers: new Set(),
        subscribed: false,
      });
    }
    this.sendSubscribe(room);
    return () => this.unsubscribe(room);
  }

  /**
   * Unsubscribe from a room. Removes all topic handlers for that room.
   */
  unsubscribe(room: string): void {
    this.rooms.delete(room);
    this.presenceCache.delete(room);
  }

  /**
   * Register an event handler for a specific room and topic.
   * Returns an unsubscribe function.
   *
   * @param room - Room name (e.g. "chat:communityA")
   * @param topic - Event topic (e.g. "message", "typing")
   * @param handler - Callback invoked with (data, sender?)
   */
  on(room: string, topic: string, handler: EventHandler): () => void {
    let state = this.rooms.get(room);
    if (!state) {
      this.subscribe(room);
      state = this.rooms.get(room)!;
    }

    let topicSet = state.topics.get(topic);
    if (!topicSet) {
      topicSet = new Set();
      state.topics.set(topic, topicSet);
    }
    topicSet.add(handler);

    this.sendTopicSubscribe(room, topic);

    return () => {
      topicSet!.delete(handler);
    };
  }

  /**
   * Remove a specific event handler.
   */
  off(room: string, topic: string, handler: EventHandler): void {
    const state = this.rooms.get(room);
    if (!state) return;
    const topicSet = state.topics.get(topic);
    if (topicSet) topicSet.delete(handler);
  }

  /**
   * Register a presence handler for a specific room.
   * Returns an unsubscribe function.
   */
  onPresence(room: string, handler: PresenceHandler): () => void {
    let state = this.rooms.get(room);
    if (!state) {
      this.subscribe(room);
      state = this.rooms.get(room)!;
    }
    state.presenceHandlers.add(handler);

    const cached = this.presenceCache.get(room);
    if (cached) {
      try { handler(cached); } catch { /* ignore */ }
    }

    return () => {
      state!.presenceHandlers.delete(handler);
    };
  }

  /**
   * Register a handler for connection status changes.
   * Returns an unsubscribe function.
   */
  onStatus(handler: StatusHandler): () => void {
    this.globalStatusHandlers.add(handler);
    return () => {
      this.globalStatusHandlers.delete(handler);
    };
  }

  // ── Publishing ────────────────────────────────────────────────────────────

  /**
   * Send a low-trust event (typing, presence heartbeat) to a room.
   */
  publish(room: string, topic: string, data: unknown): void {
    const msg = JSON.stringify({ t: 'publish', topic, data });
    this.send(msg);
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Close the WebSocket. Subscriptions are preserved for reconnect.
   */
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

  /**
   * Close and clear all state. Called on logout.
   */
  destroy(): void {
    this.close();
    this.rooms.clear();
    this.presenceCache.clear();
    this.globalEvents.clear();
    this.globalPresenceHandlers.clear();
    this.globalStatusHandlers.clear();
    this.user = null;
    this.activeRoom = null;
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  private sendSubscribe(room: string): void {
    const state = this.rooms.get(room);
    if (state) state.subscribed = true;
  }

  private sendTopicSubscribe(room: string, topic: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ t: 'subscribe', topic }));
    }
  }

  private send(msg: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      this.pending.push(msg);
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
        console.error('[realtime] presence handler error', error);
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
 * Singleton multiplexed RealtimeClient shared across the entire app.
 * One client = one WebSocket session = all logical room subscriptions.
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
