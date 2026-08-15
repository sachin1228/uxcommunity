"use client";

/**
 * Browser client for the Cloudflare realtime service (apps/realtime).
 *
 * One RealtimeClient = one room = one WebSocket. It mirrors the subscribe/
 * presence/publish model that components previously got from Supabase
 * Realtime, but talks to a Cloudflare Durable Object instead.
 *
 * The session JWT travels automatically via the same-origin cookie on the
 * WebSocket handshake, so no token plumbing is needed client-side.
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

const REALTIME_URL =
  process.env.NEXT_PUBLIC_REALTIME_URL ?? "";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 15_000;

/**
 * Build a `ws:`/`wss:` URL for the realtime WebSocket. `NEXT_PUBLIC_REALTIME_URL`
 * is an https:// origin (e.g. https://rt.uxcommunity.in), but the WebSocket
 * constructor rejects non-ws schemes with a SyntaxError. When the var is empty
 * (local dev), fall back to a same-origin relative path so the request goes to
 * whatever serves the page.
 */
function buildWebSocketUrl(baseUrl: string, room: string): string {
  if (!baseUrl) return `/ws?room=${encodeURIComponent(room)}`;
  const wsBase = baseUrl.replace(/^http/, "ws");
  return `${wsBase}/ws?room=${encodeURIComponent(room)}`;
}

interface RealtimeClientOptions {
  room: string;
  user: RealtimeUser;
  /** Reconnect on unexpected drop (default true). */
  reconnect?: boolean;
}

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly user: RealtimeUser;
  private readonly reconnectEnabled: boolean;

  private manuallyClosed = false;
  private connected = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: string[] = [];

  private readonly events = new Map<string, Set<EventHandler>>();
  private readonly presenceHandlers = new Set<PresenceHandler>();
  private readonly statusHandlers = new Set<StatusHandler>();

  constructor(options: RealtimeClientOptions) {
    this.url = buildWebSocketUrl(REALTIME_URL, options.room);
    this.user = options.user;
    this.reconnectEnabled = options.reconnect ?? true;
  }

  connect(): void {
    this.manuallyClosed = false;
    this.open();
  }

  private open(): void {
    if (this.ws && this.ws.readyState < WebSocket.CLOSING) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
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
          t: "join",
          user: this.user,
        }),
      );
    };

    ws.onmessage = (event) => {
      let msg: { t?: string; topic?: string; data?: unknown; sender?: string; users?: RealtimePresenceUser[]; message?: string };
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.t === "event" && msg.topic) {
        this.dispatch(msg.topic, msg.data, msg.sender);
      } else if (msg.t === "presence") {
        this.emitPresence(msg.users ?? []);
      } else if (msg.t === "error") {
        console.warn("[realtime]", msg.message);
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
    const msg = JSON.stringify({ t: "publish", topic, data });
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
        console.error("[realtime] event handler error", error);
      }
    }
  }

  private emitPresence(users: RealtimePresenceUser[]): void {
    for (const handler of this.presenceHandlers) {
      try {
        handler(users);
      } catch (error) {
        console.error("[realtime] presence handler error", error);
      }
    }
  }

  private emitStatus(connected: boolean): void {
    for (const handler of this.statusHandlers) {
      try {
        handler(connected);
      } catch (error) {
        console.error("[realtime] status handler error", error);
      }
    }
  }
}