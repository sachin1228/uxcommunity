/**
 * Cloudflare Realtime client for React Native / Expo.
 *
 * Singleton multiplexed client — manages multiple WebSockets.
 * Community-scoped rooms (chat:*, threads:*, events:*, resources:*, showcase:*, rules:*)
 * each get their own WebSocket directly to the CommunityDO.
 * User-scoped rooms (notifications:*, profile:*) share a connection to UserDO.
 *
 * Architecture:
 *   Hook → realtimeClient (singleton) → N WebSockets → CommunityDOs
 *   0 RPCs for message delivery.
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

/** Community-scoped room prefixes that get their own WebSocket. */
const COMMUNITY_ROOM_PREFIXES = ['chat:', 'threads:', 'events:', 'resources:', 'showcase:', 'rules:'];

function isCommunityRoom(room: string): boolean {
  return COMMUNITY_ROOM_PREFIXES.some((prefix) => room.startsWith(prefix));
}

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
 * Build a WebSocket URL for a specific room.
 * Passes the session token as a query parameter for authentication.
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

interface RoomState {
  room: string;
  topics: Map<string, Set<EventHandler>>;
  presenceHandlers: Set<PresenceHandler>;
  subscribed: boolean;
}

interface ConnectionState {
  ws: WebSocket | null;
  connected: boolean;
  manuallyClosed: boolean;
  reconnectAttempt: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  pending: string[];
}

/**
 * Singleton RealtimeClient — one per app session.
 *
 * Manages multiple WebSockets:
 *   - One per active community (for community-scoped rooms)
 *   - One for user-scoped rooms (notifications, profile)
 *
 * Every message includes a `room` field:
 *   { t: "subscribe",   room: "chat:communityA",    topic: "chat" }
 *   { t: "publish",     room: "chat:communityA",    topic: "typing", data: {} }
 *
 * Server events include `room` for routing:
 *   { t: "event", room: "chat:communityA", topic: "chat", data: ..., sender: "..." }
 */
class RealtimeClient {
  /** roomName → connection state */
  private connections = new Map<string, ConnectionState>();
  /** roomName → room subscription state */
  private rooms = new Map<string, RoomState>();

  private globalEvents = new Map<string, Set<EventHandler>>();
  private globalPresenceHandlers = new Set<PresenceHandler>();
  private globalStatusHandlers = new Set<StatusHandler>();
  private presenceCache = new Map<string, RealtimePresenceUser[]>();

  private user: RealtimeUser | null = null;

  init(user: RealtimeUser): void {
    if (!this.user) {
      this.user = user;
    }
  }

  connect(): void {
    for (const [, conn] of this.connections) {
      conn.manuallyClosed = false;
      if (!conn.ws || conn.ws.readyState >= WebSocket.CLOSING) {
        this.openConnection(conn);
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
      };
      this.connections.set(room, conn);
    }
    return conn;
  }

  private async openConnection(conn: ConnectionState): Promise<void> {
    if (conn.ws && conn.ws.readyState < WebSocket.CLOSING) return;

    const roomName = this.getRoomForConnection(conn);
    if (!roomName) return;

    const url = await buildWebSocketUrl(roomName);
    if (!url) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect(conn);
      return;
    }
    conn.ws = ws;

    ws.onopen = () => {
      conn!.connected = true;
      conn!.reconnectAttempt = 0;
      this.emitGlobalStatus(true);

      if (this.user) {
        ws.send(JSON.stringify({ t: 'join', user: this.user }));
      }

      for (const msg of conn!.pending.splice(0)) ws.send(msg);
      this.resubscribeConnection(conn!);
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
      conn!.connected = false;
      this.emitGlobalStatus(false);
      if (!conn!.manuallyClosed) this.scheduleReconnect(conn!);
    };

    ws.onerror = () => {};
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

    if (state.subscribed) {
      for (const topic of state.topics.keys()) {
        this.sendToConnection(conn, { t: 'subscribe', room: roomName, topic });
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
    if (isCommunityRoom(room)) {
      return this.getOrCreateConnection(room);
    }
    return this.getOrCreateConnection('user:global');
  }

  // ── Subscription management ───────────────────────────────────────────────

  subscribe(room: string): () => void {
    if (!this.rooms.has(room)) {
      this.rooms.set(room, {
        room,
        topics: new Map(),
        presenceHandlers: new Set(),
        subscribed: false,
      });
    }
    const state = this.rooms.get(room)!;
    state.subscribed = true;
    return () => this.unsubscribe(room);
  }

  unsubscribe(room: string): void {
    const state = this.rooms.get(room);
    if (!state) return;
    this.rooms.delete(room);
    this.presenceCache.delete(room);

    const conn = this.getRoomConnection(room);
    if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
      for (const topic of state.topics.keys()) {
        this.sendToConnection(conn, { t: 'unsubscribe', room, topic });
      }
    }

    // Clean up connection if no rooms use it
    this.maybeRemoveConnection(room);
  }

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

    const conn = this.getRoomConnection(room);
    this.sendToConnection(conn, { t: 'subscribe', room, topic });
    // Ensure connection is open
    if (!conn.ws || conn.ws.readyState >= WebSocket.CLOSING) {
      this.openConnection(conn);
    }

    return () => {
      topicSet!.delete(handler);
    };
  }

  off(room: string, topic: string, handler: EventHandler): void {
    const state = this.rooms.get(room);
    if (!state) return;
    const topicSet = state.topics.get(topic);
    if (topicSet) topicSet.delete(handler);
  }

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

  onStatus(handler: StatusHandler): () => void {
    this.globalStatusHandlers.add(handler);
    return () => {
      this.globalStatusHandlers.delete(handler);
    };
  }

  // ── Publishing ────────────────────────────────────────────────────────────

  publish(room: string, topic: string, data: unknown): void {
    const conn = this.getRoomConnection(room);
    this.sendToConnection(conn, { t: 'publish', room, topic, data });
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

  private maybeRemoveConnection(room: string): void {
    if (!isCommunityRoom(room)) return;
    const conn = this.connections.get(room);
    if (!conn) return;

    // Check if any other rooms use this connection
    for (const [r, c] of this.connections) {
      if (c === conn && r !== room) return;
    }

    // No other rooms — close and remove
    if (conn.reconnectTimer !== null) {
      clearTimeout(conn.reconnectTimer);
    }
    if (conn.ws) {
      try { conn.ws.close(); } catch { /* ignore */ }
    }
    this.connections.delete(room);
  }

  private sendToConnection(conn: ConnectionState, msg: unknown): void {
    const json = JSON.stringify(msg);
    if (conn.ws && conn.ws.readyState === WebSocket.OPEN) {
      conn.ws.send(json);
    } else {
      conn.pending.push(json);
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
 * Singleton RealtimeClient — manages multiple WebSockets, one per community.
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
