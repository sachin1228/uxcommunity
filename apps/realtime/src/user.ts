import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { RealtimeMetrics } from "./metrics";
import {
  PublishRateLimiter,
  SOCKET_PUBLISH_BURST,
  SOCKET_PUBLISH_REFILL_PER_SECOND,
  guardClientPublish,
} from "./client-publish";
import { TopicSocketIndex } from "./subscriptions";
import { EventIdDedupe } from "./event-dedupe";
import type { PublishRequest } from "./types";
import { encodeEventFrame, helloFrame, readPublishRequest } from "./wire";

/**
 * User Durable Object — ONE per user (`user:${userId}`). Owns the single
 * browser/device WebSocket multiplexing that user's logical user-scoped rooms
 * (notifications, …).
 *
 * Community-scoped rooms (chat, threads, events, resources, showcase, rules)
 * are handled by CommunityDO directly — 0 RPCs.
 *
 * State model:
 *   WebSocket attachment: { userId, subs }
 *   In-memory: topic subscriptions per WebSocket connection + a
 *   (room, topic) → sockets index so a publish touches only its recipients.
 *
 * Fan-out:
 *   A user's DO usually holds one socket per device/tab, so the old "walk every
 *   client and test its subscription map" was already small — but it still cost
 *   O(all sockets) per event and retried dead sockets forever. The index makes
 *   it O(recipients) and failed sends evict the socket immediately.
 *
 * Authorization:
 *   User-scoped rooms (notifications:, profile:) carry events the SERVER
 *   publishes over POST /publish after the API routes have authorized the
 *   write. A client publish frame is therefore subject to the same allow-list,
 *   payload validation and per-socket rate limit as a community room
 *   (client-publish.ts): nothing a member's own socket may publish here.
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

/** Composite index key: a subscription is (logical room, topic). */
function subscriptionKey(room: string, topic: string): string {
  return `${room}\u0000${topic}`;
}

export class UserDO extends DurableObject<Env> {
  private clients = new Map<WebSocket, ClientState>();
  /** (room, topic) → sockets, for targeted delivery. */
  private subscriptions = new TopicSocketIndex<WebSocket>();
  private reconstructed = false;

  /** Event ids already applied — drops fan-out retries (see event-dedupe.ts). */
  private publishedEventIds = new EventIdDedupe();

  /** One client-publish bucket per socket; released when the socket goes. */
  private socketPublishLimit = new PublishRateLimiter<WebSocket>(
    SOCKET_PUBLISH_BURST,
    SOCKET_PUBLISH_REFILL_PER_SECOND,
  );

  readonly metrics = new RealtimeMetrics();

  /** Opaque token for THIS in-memory instance — see CommunityDO's `instanceId`. */
  private readonly instanceId = crypto.randomUUID().slice(0, 8);

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

    // Aggregate-only introspection for operations.
    if (request.headers.get("x-realtime-stats") === this.env.REALTIME_PUBLISH_SECRET) {
      return Response.json({
        instanceId: this.instanceId,
        sockets: this.clients.size,
        subscriptionRefs: this.subscriptions.referenceCount,
        metrics: this.metrics.toJSON(),
      });
    }

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
      const set = new Set(topics);
      subscriptions.set(room, set);
      for (const topic of set) {
        this.subscriptions.add(subscriptionKey(room, topic), ws);
      }
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
    this.metrics.connectionsOpened += 1;

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
      this.sendToClient(ws, helloFrame(crypto.randomUUID()));
    } else if (msg.t === "subscribe" && msg.room && msg.topic) {
      this.handleSubscribe(state, ws, msg.room, msg.topic);
      this.persist(ws, state);
    } else if (msg.t === "unsubscribe" && msg.room && msg.topic) {
      this.handleUnsubscribe(state, ws, msg.room, msg.topic);
      this.persist(ws, state);
    } else if (msg.t === "publish" && msg.room && msg.topic) {
      this.handlePublish(state, ws, msg.room, msg.topic, msg.data);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.ensureReconstructed();
    this.clients.delete(ws);
    this.subscriptions.removeSocket(ws);
    this.socketPublishLimit.release(ws);
    this.metrics.connectionsClosed += 1;
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  /**
   * Drop a socket whose `send()` failed. Without this the socket stays in the
   * subscription index and every later event retries a connection that can
   * never succeed.
   */
  private evictSocket(ws: WebSocket): void {
    this.clients.delete(ws);
    this.subscriptions.removeSocket(ws);
    this.socketPublishLimit.release(ws);
    this.metrics.connectionsClosed += 1;
    this.metrics.sendFailures += 1;
    try {
      ws.close(1011, "send failed");
    } catch {
      // Already closed.
    }
  }

  // ── HTTP publish (server-side) ───────────────────────────────────────

  private async publish(request: Request): Promise<Response> {
    const body: PublishRequest | null = await readPublishRequest(request);
    if (!body) {
      return new Response("Bad request", { status: 400 });
    }

    // Idempotency: a retried publish carries the same `event_id`; a duplicate
    // delivery is acknowledged without a second fan-out.
    if (body.event_id && !this.publishedEventIds.accept(body.event_id)) {
      this.metrics.duplicateDeliveriesSuppressed += 1;
      return new Response("ok");
    }

    const eventMsg = encodeEventFrame({
      room: body.room,
      topic: body.topic,
      data: body.data,
      sender: body.exclude_user,
    });

    this.deliver(subscriptionKey(body.room, body.topic), eventMsg, body.exclude_user);
    return new Response("ok");
  }

  /** Send `eventMsg` to the sockets subscribed to one (room, topic) pair. */
  private deliver(key: string, eventMsg: string, excludeUserId?: string): void {
    const recipients = this.subscriptions.subscribers(key);
    if (!recipients || recipients.size === 0) return;

    this.metrics.eventsPublished += 1;
    this.metrics.fanoutRecipients += recipients.size;

    for (const ws of recipients) {
      const state = this.clients.get(ws);
      if (!state) continue;
      if (excludeUserId && state.userId === excludeUserId) continue;

      this.metrics.deliverAttempts += 1;
      try {
        ws.send(eventMsg);
      } catch {
        this.evictSocket(ws);
      }
    }
  }

  // ── Subscription handling (user-scoped rooms) ─────────────────────────

  private handleSubscribe(state: ClientState, ws: WebSocket, room: string, topic: string): void {
    let topics = state.subscriptions.get(room);
    if (!topics) {
      topics = new Set();
      state.subscriptions.set(room, topics);
    }
    topics.add(topic);
    // Duplicate subscribe frames are absorbed by the index.
    this.subscriptions.add(subscriptionKey(room, topic), ws);
  }

  private handleUnsubscribe(state: ClientState, ws: WebSocket, room: string, topic: string): void {
    const topics = state.subscriptions.get(room);
    if (topics) {
      topics.delete(topic);
      if (topics.size === 0) {
        state.subscriptions.delete(room);
      }
    }
    this.subscriptions.remove(subscriptionKey(room, topic), ws);
  }

  private handlePublish(state: ClientState, ws: WebSocket, room: string, topic: string, data: unknown): void {
    // Same boundary as the community DO: a member cannot publish a topic or a
    // payload the server owns. Identity is stamped from the authenticated
    // socket, never echoed from the frame.
    const decision = guardClientPublish(topic, data, { userId: state.userId });
    if (!decision.ok) {
      if (decision.reason === "topic") this.metrics.clientPublishRejectedTopic += 1;
      else this.metrics.clientPublishRejectedPayload += 1;
      return;
    }

    if (!state.subscriptions.get(room)?.has(topic)) return;
    if (!this.socketPublishLimit.allow(ws)) {
      this.metrics.clientPublishRateLimited += 1;
      return;
    }

    this.metrics.clientPublishesAccepted += 1;

    const eventMsg = encodeEventFrame({
      room,
      topic,
      data: decision.data,
      sender: state.userId,
    });

    // The publisher's own sockets are the exclusion set, matching the previous
    // behaviour where a client never received its own event back.
    this.deliver(subscriptionKey(room, topic), eventMsg, state.userId);
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private sendToClient(ws: WebSocket, msg: unknown): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      this.evictSocket(ws);
    }
  }
}
