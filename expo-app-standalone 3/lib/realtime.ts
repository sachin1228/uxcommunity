/**
 * Cloudflare Realtime client for React Native / Expo.
 *
 * Replaces Supabase Realtime for application realtime events (chat, typing,
 * reactions). Uses the same WebSocket endpoint, protocol, and event model
 * as the web app.
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
 * Cloudflare Realtime client for React Native.
 *
 * One RealtimeClient = one room = one WebSocket. Uses the same protocol
 * as the web client (apps/web/lib/realtime/client.ts).
 */
export class RealtimeClient {
  private ws: WebSocket | null = null;
  private room: string;
  private user: RealtimeUser;
  private reconnectEnabled: boolean;

  private manuallyClosed = false;
  private connected = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: string[] = [];

  private events = new Map<string, Set<EventHandler>>();
  private presenceHandlers = new Set<PresenceHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private cachedPresence: RealtimePresenceUser[] = [];

  constructor(options: { room: string; user: RealtimeUser; reconnect?: boolean }) {
    this.room = options.room;
    this.user = options.user;
    this.reconnectEnabled = options.reconnect ?? true;
  }

  async connect(): Promise<void> {
    this.manuallyClosed = false;
    await this.open();
  }

  private async open(): Promise<void> {
    if (this.ws && this.ws.readyState < WebSocket.CLOSING) return;

    const url = await buildWebSocketUrl(this.room);
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
      this.emitStatus(true);
      for (const msg of this.pending.splice(0)) ws.send(msg);
      ws.send(
        JSON.stringify({
          t: 'join',
          user: this.user,
        }),
      );
    };

    ws.onmessage = (event: { data: string | ArrayBuffer }) => {
      let msg: { t?: string; room?: string; topic?: string; data?: unknown; sender?: string; users?: RealtimePresenceUser[]; joined?: RealtimePresenceUser; left?: { id: string }; message?: string };
      try {
        msg = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data));
      } catch {
        return;
      }
      if (msg.t === 'event' && msg.topic) {
        this.dispatch(msg.topic, msg.data, msg.sender);
      } else if (msg.t === 'presence') {
        this.cachedPresence = msg.users ?? [];
        this.emitPresence(this.cachedPresence);
      } else if (msg.t === 'presence_delta') {
        if (msg.joined) {
          this.cachedPresence = [
            ...this.cachedPresence.filter((u) => u.id !== msg.joined!.id),
            msg.joined,
          ];
        } else if (msg.left) {
          this.cachedPresence = this.cachedPresence.filter((u) => u.id !== msg.left!.id);
        }
        this.emitPresence(this.cachedPresence);
      } else if (msg.t === 'error') {
        console.warn('[realtime]', msg.message);
      }
    };

    ws.onclose = () => {
      this.connected = false;
      this.emitStatus(false);
      if (!this.manuallyClosed && this.reconnectEnabled) {
        this.scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose follows and handles reconnect.
    };
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

  /** Subscribe to a topic. Returns an unsubscribe function. */
  on(topic: string, handler: EventHandler): () => void {
    let set = this.events.get(topic);
    if (!set) {
      set = new Set();
      this.events.set(topic, set);
    }
    set.add(handler);
    return () => {
      set!.delete(handler);
    };
  }

  onPresence(handler: PresenceHandler): () => void {
    this.presenceHandlers.add(handler);
    return () => {
      this.presenceHandlers.delete(handler);
    };
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  /** Send a low-trust event (typing, presence heartbeat) to other members. */
  publish(topic: string, data: unknown): void {
    const msg = JSON.stringify({ t: 'publish', topic, data });
    this.send(msg);
  }

  private send(msg: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(msg);
    } else {
      this.pending.push(msg);
    }
  }

  close(): void {
    this.manuallyClosed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.pending = [];
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.connected = false;
    this.emitStatus(false);
  }

  isConnected(): boolean {
    return this.connected;
  }

  private dispatch(topic: string, data: unknown, sender?: string): void {
    const handlers = this.events.get(topic);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(data, sender);
      } catch (error) {
        console.error('[realtime] event handler error', error);
      }
    }
  }

  private emitPresence(users: RealtimePresenceUser[]): void {
    for (const handler of this.presenceHandlers) {
      try {
        handler(users);
      } catch (error) {
        console.error('[realtime] presence handler error', error);
      }
    }
  }

  private emitStatus(connected: boolean): void {
    for (const handler of this.statusHandlers) {
      try {
        handler(connected);
      } catch (error) {
        console.error('[realtime] status handler error', error);
      }
    }
  }
}

/**
 * Room name helpers — matches the web app's rooms.ts.
 */
export const realtimeRooms = {
  chat: (communityId: string) => `chat:${communityId}`,
  typing: (communityId: string) => `typing:${communityId}`,
  presence: (communityId: string) => `presence:${communityId}`,
  threads: (communityId: string) => `threads:${communityId}`,
  events: (communityId: string) => `events:${communityId}`,
  resources: (communityId: string) => `resources:${communityId}`,
} as const;
