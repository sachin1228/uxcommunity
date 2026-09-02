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

/** Persisted on the WebSocket so subscriptions survive hibernation. */
interface UserAttachment {
  userId: string;
  /** room → topics */
  subs?: Record<string, string[]>;
}

export class UserDO extends DurableObject<Env> {
  private clients = new Map<WebSocket, ClientState>();
  private reconstructed = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Heartbeat auto-response — answered by the runtime without waking the DO.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    // Rebuild client state before the first event (often a webSocketMessage).
    this.ctx.blockConcurrencyWhile(async () => this.ensureReconstructed());
  }

  // ── Fetch handler ────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    this.ensureReconstructed();

    // Server-side publish via HTTP POST
    if (request.headers.get("x-realtime-publish-secret")) {
      return this.publish(request);
    }

    if (request.headers.get("Upgrade") === "websocket") {
      return this.upgrade(request);
    }
    return new Response("Not found", { status: 404 });
  }

  // ── Hibernation-safe state reconstruction ──────────────────────────────

  private ensureReconstructed(): void {
    if (this.reconstructed) return;
    for (const ws of this.ctx.getWebSockets()) {
      this.adoptSocket(ws);
    }
    this.reconstructed = true;
  }

  private adoptSocket(ws: WebSocket): ClientState | null {
    let attachment: UserAttachment | undefined;
    try {
      attachment = ws.deserializeAttachment() as UserAttachment | undefined;
    } catch {
      return null;
    }
    if (!attachment?.userId) return null;

    const subscriptions = new Map<string, Set<string>>();
    for (const [room, topics] of Object.entries(attachment.subs ?? {})) {
      subscriptions.set(room, new Set(topics));
    }

    const state: ClientState = { userId: attachment.userId, subscriptions };
    this.clients.set(ws, state);
    return state;
  }

  private persist(ws: WebSocket, state: ClientState): void {
    const subs: Record<string, string[]> = {};
    for (const [room, topics] of state.subscriptions) {
      subs[room] = [...topics];
    }
    const attachment: UserAttachment = { userId: state.userId, subs };
    try {
      ws.serializeAttachment(attachment);
    } catch {
      // Attachment too large or socket gone — in-memory state still works
      // until the next hibernation.
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
    const attachment: UserAttachment = { userId, subs: {} };
    server.serializeAttachment(attachment);

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

    this.ensureReconstructed();
    let state = this.clients.get(ws);
    if (!state) {
      // Not tracked (post-hibernation edge) — recover from the attachment.
      state = this.adoptSocket(ws) ?? undefined;
      if (!state) return;
    }

    if (msg.t === "join") {
      if (!msg.user || msg.user.id !== state.userId) return;
      this.sendToClient(ws, { t: "hello", connectionId: crypto.randomUUID() });
    } else if (msg.t === "subscribe" && msg.room && msg.topic) {
      this.handleSubscribe(state, msg.room, msg.topic);
      this.persist(ws, state);
    } else if (msg.t === "unsubscribe" && msg.room && msg.topic) {
      this.handleUnsubscribe(state, msg.room, msg.topic);
      this.persist(ws, state);
    } else if (msg.t === "publish" && msg.room && msg.topic) {
      this.handlePublish(state, msg.room, msg.topic, msg.data);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.ensureReconstructed();
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
