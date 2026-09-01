import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

/**
 * User Durable Object — ONE per user. Owns the single client WebSocket
 * for user-scoped rooms (notifications, profile, designers-studio).
 *
 * Community-scoped rooms (chat, threads, events, resources, showcase, rules)
 * are handled by CommunityDO directly — 0 RPCs.
 *
 * State model:
 *   WebSocket attachment: { userId: string }
 *   In-memory: topic subscriptions per WebSocket connection
 */

interface ClientState {
  userId: string;
  subscriptions: Map<string, Set<string>>; // room → Set<topics>
}

export class UserDO extends DurableObject<Env> {
  private clients = new Map<WebSocket, ClientState>();
  private reconstructed = false;

  // ── Fetch handler ────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    // Server-side publish via HTTP POST
    if (request.headers.get("x-realtime-publish-secret")) {
      return this.publish(request);
    }

    if (!this.reconstructed) {
      await this.ctx.blockConcurrencyWhile(() => this.reconstructState());
      this.reconstructed = true;
    }

    if (request.headers.get("Upgrade") === "websocket") {
      return this.upgrade(request);
    }
    return new Response("Not found", { status: 404 });
  }

  // ── Hibernation-safe state reconstruction ──────────────────────────────

  private async reconstructState(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as
        | { userId?: string }
        | undefined;

      if (!attachment?.userId) continue;

      this.clients.set(ws, {
        userId: attachment.userId,
        subscriptions: new Map(),
      });
    }
  }

  // ── WebSocket lifecycle ───────────────────────────────────────────────

  private async upgrade(request: Request): Promise<Response> {
    const userId = request.headers.get("x-realtime-uid");
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId });

    this.clients.set(server, {
      userId,
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
      this.sendToClient(ws, { t: "hello", connectionId: crypto.randomUUID() });
    } else if (msg.t === "subscribe" && msg.room && msg.topic) {
      this.handleSubscribe(state, msg.room, msg.topic);
    } else if (msg.t === "unsubscribe" && msg.room && msg.topic) {
      this.handleUnsubscribe(state, msg.room, msg.topic);
    } else if (msg.t === "publish" && msg.room && msg.topic) {
      this.handlePublish(state, msg.room, msg.topic, msg.data);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.clients.delete(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // ── HTTP publish (server-side) ───────────────────────────────────────

  private async publish(request: Request): Promise<Response> {
    let body: { room?: string; topic?: string; data?: unknown; exclude_user?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (!body.room || !body.topic) {
      return new Response("Bad request", { status: 400 });
    }

    const eventMsg = JSON.stringify({
      t: "event",
      room: body.room,
      topic: body.topic,
      data: body.data,
      sender: body.exclude_user,
    });

    for (const [ws, state] of this.clients) {
      const topics = state.subscriptions.get(body.room);
      if (!topics?.has(body.topic)) continue;
      if (body.exclude_user && state.userId === body.exclude_user) continue;

      try {
        ws.send(eventMsg);
      } catch {
        // WebSocket send failed — will be cleaned up on close
      }
    }

    return new Response("ok");
  }

  // ── Subscription handling (user-scoped rooms) ─────────────────────────

  private handleSubscribe(state: ClientState, room: string, topic: string): void {
    let topics = state.subscriptions.get(room);
    if (!topics) {
      topics = new Set();
      state.subscriptions.set(room, topics);
    }
    topics.add(topic);
  }

  private handleUnsubscribe(state: ClientState, room: string, topic: string): void {
    const topics = state.subscriptions.get(room);
    if (topics) {
      topics.delete(topic);
      if (topics.size === 0) {
        state.subscriptions.delete(room);
      }
    }
  }

  private handlePublish(state: ClientState, room: string, topic: string, data: unknown): void {
    const topics = state.subscriptions.get(room);
    if (!topics?.has(topic)) return;

    const eventMsg = JSON.stringify({
      t: "event",
      room,
      topic,
      data,
      sender: state.userId,
    });

    for (const [clientWs, clientState] of this.clients) {
      const clientTopics = clientState.subscriptions.get(room);
      if (!clientTopics?.has(topic)) continue;
      if (clientState.userId === state.userId) continue;

      try {
        clientWs.send(eventMsg);
      } catch {
        // WebSocket send failed — will be cleaned up on close
      }
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private sendToClient(ws: WebSocket, msg: unknown): void {
    try { ws.send(JSON.stringify(msg)); } catch { /* ignore */ }
  }
}
