import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

interface ClientState {
  userId: string;
  user: { id: string; name: string; avatar: string | null };
  /** room → set of subscribed topics */
  subscriptions: Map<string, Set<string>>;
}

interface CommunityConn {
  ws: WebSocket;
  topics: Set<string>;
}

/**
 * User-scoped Durable Object — ONE per user. Owns the single client WebSocket
 * and routes logical subscriptions to community DOs.
 *
 * Architecture:
 *   Client (1 WS) → UserDO (user:${userId}) → Community DOs
 *
 *   - Client connects once via WebSocket to this DO
 *   - Client sends messages with a `room` field (e.g. "chat:communityA")
 *   - UserDO maintains WebSocket connections to each community DO
 *   - Community DO broadcasts events back through the same WS connection
 *   - UserDO filters and routes events to the correct client handlers
 *
 * Scaling: one DO per user. Each user DO connects to ~K community DOs
 * (where K = number of communities the user is subscribed to).
 */
export class UserDO extends DurableObject<Env> {
  private clients = new Map<WebSocket, ClientState>();
  private communityConns = new Map<string, CommunityConn>();

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") === "websocket") {
      return this.upgrade(request);
    }
    return new Response("Not found", { status: 404 });
  }

  private async upgrade(request: Request): Promise<Response> {
    const userId = request.headers.get("x-realtime-uid");
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);

    this.clients.set(server, {
      userId,
      user: { id: userId, name: "", avatar: null },
      subscriptions: new Map(),
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    let msg: {
      t?: string;
      room?: string;
      topic?: string;
      data?: unknown;
      user?: { id: string; name: string; avatar: string | null };
    };
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }

    const state = this.clients.get(ws);
    if (!state) return;

    if (msg.t === "join") {
      if (!msg.user || msg.user.id !== state.userId) return;
      state.user = msg.user;
      this.sendToClient(ws, { t: "hello", connectionId: crypto.randomUUID() });
    } else if (msg.t === "subscribe" && msg.room && msg.topic) {
      this.handleSubscribe(ws, state, msg.room, msg.topic);
    } else if (msg.t === "unsubscribe" && msg.room && msg.topic) {
      this.handleUnsubscribe(ws, state, msg.room, msg.topic);
    } else if (msg.t === "publish" && msg.room && msg.topic) {
      this.handlePublish(ws, state, msg.room, msg.topic, msg.data);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const state = this.clients.get(ws);
    if (!state) return;

    for (const [room, topics] of state.subscriptions) {
      for (const topic of topics) {
        this.sendToCommunity(room, { t: "unsubscribe", topic });
      }
      this.maybeDisconnectCommunity(room);
    }
    this.clients.delete(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // ── Subscription routing ────────────────────────────────────────────────

  private handleSubscribe(
    ws: WebSocket,
    state: ClientState,
    room: string,
    topic: string,
  ): void {
    let topics = state.subscriptions.get(room);
    if (!topics) {
      topics = new Set();
      state.subscriptions.set(room, topics);
    }
    const isNew = topics.size === 0;
    topics.add(topic);

    if (isNew) {
      this.ensureCommunityConn(room, state.userId);
    }
    this.sendToCommunity(room, { t: "subscribe", topic });
  }

  private handleUnsubscribe(
    ws: WebSocket,
    state: ClientState,
    room: string,
    topic: string,
  ): void {
    const topics = state.subscriptions.get(room);
    if (!topics) return;
    topics.delete(topic);

    this.sendToCommunity(room, { t: "unsubscribe", topic });

    if (topics.size === 0) {
      state.subscriptions.delete(room);
      this.maybeDisconnectCommunity(room);
    }
  }

  private handlePublish(
    ws: WebSocket,
    state: ClientState,
    room: string,
    topic: string,
    data: unknown,
  ): void {
    const topics = state.subscriptions.get(room);
    if (!topics || !topics.has(topic)) return;

    this.sendToCommunity(room, {
      t: "publish",
      topic,
      data,
      userId: state.userId,
    });
  }

  // ── Community DO connections ─────────────────────────────────────────────

  private ensureCommunityConn(room: string, userId: string): void {
    if (this.communityConns.has(room)) return;

    const id = this.env.COMMUNITY_DO.idFromName(room);
    const stub = this.env.COMMUNITY_DO.get(id);

    const upgraded = new Request(`https://dummy/ws?room=${encodeURIComponent(room)}`, {
      headers: { Upgrade: "websocket", "x-realtime-uid": userId, "x-realtime-role": "userdo" },
    });

    stub.fetch(upgraded).then((response) => {
      const ws = (response as any).webSocket;
      if (!ws) return;

      this.ctx.acceptWebSocket(ws);
      this.communityConns.set(room, { ws, topics: new Set() });

      ws.addEventListener("message", (event: MessageEvent) => {
        this.onCommunityMessage(room, String(event.data));
      });
      ws.addEventListener("close", () => {
        this.communityConns.delete(room);
      });
      ws.addEventListener("error", () => {
        this.communityConns.delete(room);
      });
    }).catch(() => {
      // Connection failed; will retry on next subscribe
    });
  }

  private maybeDisconnectCommunity(room: string): void {
    const conn = this.communityConns.get(room);
    if (!conn) return;

    let anyClientSubscribed = false;
    for (const [, state] of this.clients) {
      if (state.subscriptions.has(room) && state.subscriptions.get(room)!.size > 0) {
        anyClientSubscribed = true;
        break;
      }
    }
    if (!anyClientSubscribed) {
      try { conn.ws.close(); } catch { /* ignore */ }
      this.communityConns.delete(room);
    }
  }

  private onCommunityMessage(room: string, raw: string): void {
    let msg: { t?: string; room?: string; topic?: string; data?: unknown; sender?: string; users?: unknown[]; joined?: unknown; left?: unknown; message?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    for (const [ws, state] of this.clients) {
      const topics = state.subscriptions.get(room);
      if (!topics || topics.size === 0) continue;

      if (msg.t === "event" && msg.topic) {
        if (!topics.has(msg.topic)) continue;
        if (msg.sender === state.userId) continue;
        this.sendToClient(ws, {
          t: "event",
          room,
          topic: msg.topic,
          data: msg.data,
          sender: msg.sender,
        });
      } else if (msg.t === "presence" || msg.t === "presence_delta") {
        this.sendToClient(ws, { ...msg, room });
      } else if (msg.t === "error") {
        this.sendToClient(ws, msg);
      }
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private sendToCommunity(room: string, msg: unknown): void {
    const conn = this.communityConns.get(room);
    if (!conn || conn.ws.readyState !== WebSocket.OPEN) return;
    try {
      conn.ws.send(JSON.stringify(msg));
    } catch { /* ignore */ }
  }

  private sendToClient(ws: WebSocket, msg: unknown): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch { /* ignore */ }
  }
}
