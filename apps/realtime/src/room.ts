import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import { RealtimeMetrics } from "./metrics";
import {
  PublishRateLimiter,
  SOCKET_PUBLISH_BURST,
  SOCKET_PUBLISH_REFILL_PER_SECOND,
  USER_PUBLISH_BURST,
  USER_PUBLISH_REFILL_PER_SECOND,
  guardClientPublish,
} from "./client-publish";
import { TopicSocketIndex } from "./subscriptions";
import {
  SocketRegistry,
  type WebSocketAttachment,
} from "./socket-registry";
import { EventIdDedupe } from "./event-dedupe";
import { MembershipAuthorizer } from "./membership-auth";
import { PresenceBroadcaster } from "./presence";
import { encodeEventFrame, helloFrame, readPublishRequest } from "./wire";

/**
 * Community Durable Object — ONE per community. Handles all logical realtime
 * topics (chat, typing, presence, threads, events, resources, showcase, rules).
 *
 * Architecture (direct WebSocket ownership):
 *   Client → CommunityDO (direct WebSocket) → ws.send() → Client(s)
 *   0 RPCs for message delivery.
 *
 * State scoping:
 *   SOCKET-scoped (per individual WebSocket connection):
 *     sockets             = wsToUser + userSockets (see socket-registry.ts)
 *     subscriptions       = topic → sockets (targeted fan-out index)
 *   USER-scoped (multi-device bookkeeping + presence):
 *     userMeta[userId]    = { name, avatar } cached at join() so client-publish
 *                           frames never have to deserialize attachments
 *
 * Fan-out:
 *   A publish resolves `subscriptions.subscribers(topic)` and sends only to
 *   those sockets. The earlier revision walked every socket in the DO and asked
 *   each one whether it was subscribed, which made one event's cost proportional
 *   to the room population rather than to its recipients.
 *
 * Multi-device safety:
 *   Subscriptions are per socket, so closing one tab can never remove another
 *   tab's subscription.
 *
 * WebSocket state (hibernation-safe):
 *   Each WebSocket attachment stores { userId, topics, name, avatar }.
 *   On wake, ctx.getWebSockets() + deserializeAttachment() rebuilds all maps.
 *
 * Authorization:
 *   - WebSocket upgrade requires x-realtime-uid header (set by Worker after JWT auth)
 *   - Membership checked via internal API (fail-closed) with a bounded cache
 *   - Client publishes are restricted by an explicit topic allow-list, a minimal
 *     payload validator and per-socket/per-user token buckets (client-publish.ts).
 *     Every persisted room event is server-authored and arrives over the
 *     secret-authenticated POST /publish path instead.
 *
 * Event classification:
 *   - EPHEMERAL (typing, presence): drop on delivery failure, no retry
 *   - DURABLE (chat, edit, delete, reaction): client recovers via DB
 *
 * Presence is coalesced and lap-budgeted — see presence.ts.
 */

export class Room extends DurableObject<Env> {
  /**
   * Targeted fan-out index: topic → sockets that subscribed to it.
   * This is the only structure a broadcast reads.
   */
  private subscriptions = new TopicSocketIndex<WebSocket>();

  /**
   * Socket → userId, userId → its sockets, and the display metadata cached at
   * join() (multi-device bookkeeping + the presence count).
   */
  private sockets = new SocketRegistry();

  /** In-flight reconstruction, shared so concurrent callers await the same work. */
  private reconstructPromise: Promise<void> | null = null;
  private reconstructed = false;

  /**
   * Event ids already applied by this room — drops fan-out retries that race a
   * successful first attempt. Bounded + TTL'd (see event-dedupe.ts).
   */
  private publishedEventIds = new EventIdDedupe();

  /**
   * Client-publish rate limits. Both are keyed by things that already live in
   * this DO — one bucket per socket, one per user with sockets in the room —
   * and are released with the socket/users that own them, so neither map can
   * grow with traffic.
   */
  private socketPublishLimit = new PublishRateLimiter<WebSocket>(
    SOCKET_PUBLISH_BURST,
    SOCKET_PUBLISH_REFILL_PER_SECOND,
  );
  private userPublishLimit = new PublishRateLimiter<string>(
    USER_PUBLISH_BURST,
    USER_PUBLISH_REFILL_PER_SECOND,
  );

  readonly metrics = new RealtimeMetrics();

  /** Coalesced online-count broadcasts for this room — see presence.ts. */
  private readonly presence = new PresenceBroadcaster({
    getSockets: () => this.ctx.getWebSockets(),
    socketsByUser: this.sockets.socketsByUser,
    // A replaced/extra socket must be told the count even when the count itself
    // did not move (see presence.ts) — the registry owns that generation.
    socketGeneration: () => this.sockets.socketGeneration,
    roomName: this.roomName(),
    metrics: this.metrics,
    onSendFailed: (ws) => this.removeSocket(ws, "send-failed"),
  });

  /** Community membership authorization (fail-closed) — see membership-auth.ts. */
  private readonly membership = new MembershipAuthorizer({
    storage: this.ctx.storage,
    env: this.env,
    communityId: this.communityIdFromRoom(),
    roomName: this.roomName(),
    metrics: this.metrics,
  });

  /**
   * Opaque token for THIS in-memory instance. A hibernating DO is evicted and
   * recreated freely, and a recreated instance starts its counters at zero and
   * rebuilds its sockets from the attachments — so "is this the instance that
   * served the request I just made?" is the first question any counter reading
   * raises, and the token answers it without exposing anything about the room.
   */
  private readonly instanceId = crypto.randomUUID().slice(0, 8);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Heartbeats: the client sends "ping" and the runtime answers "pong"
    // WITHOUT waking a hibernated DO, so idle sockets stay provably alive.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));

    // After hibernation the first event is frequently a webSocketMessage (e.g.
    // a typing publish), not a fetch. Rebuild socket/user maps up front so that
    // frame is not silently dropped because the maps are empty.
    this.ctx.blockConcurrencyWhile(() => this.ensureSubscribers());
  }

  // ── Fetch handler ──────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    // Aggregate-only introspection for operations (never message contents).
    if (request.headers.get("x-realtime-stats") === this.env.REALTIME_PUBLISH_SECRET) {
      return Response.json(this.stats());
    }

    // Server-side publish via HTTP POST
    if (request.headers.get("x-realtime-publish-secret")) {
      return this.publish(request);
    }

    // WebSocket upgrade — CommunityDO owns connections directly
    if (request.headers.get("Upgrade") === "websocket") {
      return this.upgrade(request);
    }

    return new Response("Not found", { status: 404 });
  }

  /** Counts only: connections, subscribers, fan-out and failure totals. */
  private stats(): Record<string, unknown> {
    return {
      room: this.roomName(),
      instanceId: this.instanceId,
      sockets: this.sockets.socketCount,
      users: this.sockets.userCount,
      topics: this.subscriptions.topicCount,
      subscriptionRefs: this.subscriptions.referenceCount,
      membershipCacheSize: this.membership.cacheSize,
      metrics: this.metrics.toJSON(),
    };
  }

  // ── WebSocket lifecycle (hibernation-safe) ─────────────────────────

  private async upgrade(request: Request): Promise<Response> {
    const userId = request.headers.get("x-realtime-uid");
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    // Check membership before accepting connection.
    // Sub-entity rooms (thread-comments:*, resource-comments:*) don't carry a
    // community ID in the room name, so skip the check — authorization is
    // handled by the API routes that publish to these rooms.
    const room = this.roomName();
    const isSubEntityRoom = room.startsWith("thread-comments:") || room.startsWith("resource-comments:");
    if (!isSubEntityRoom) {
      const isMember = await this.membership.check(userId);
      if (!isMember) {
        return new Response("Forbidden", { status: 403 });
      }
    }

    await this.ensureSubscribers();

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernation API: accept without keeping a reference
    this.ctx.acceptWebSocket(server);

    // Attach metadata to the WebSocket (survives hibernation)
    const attachment: WebSocketAttachment = {
      userId,
      topics: [],
      name: null,
      avatar: null,
    };
    server.serializeAttachment(attachment);

    this.sockets.track(server, userId);
    this.metrics.connectionsOpened += 1;
    // A new socket changes the online-member count (it counts before its `join`
    // frame lands, exactly like the previous roster snapshot did).
    this.markPresenceDirty();

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

    // Guard: make sure socket maps are populated (post-hibernation wake).
    await this.ensureSubscribers();

    let userId: string | undefined = this.sockets.userId(ws);
    if (!userId) {
      // Socket accepted but not tracked (e.g. reconstructed set changed).
      // Fall back to the attachment so the frame is never silently dropped.
      userId = this.adoptSocket(ws) ?? undefined;
      if (!userId) return;
    }

    if (msg.t === "join") {
      if (!msg.user || msg.user.id !== userId) return;

      const attachment = ws.deserializeAttachment() as WebSocketAttachment | undefined;
      if (attachment) {
        attachment.name = msg.user.name ?? null;
        attachment.avatar = msg.user.avatar ?? null;
        ws.serializeAttachment(attachment);
      }
      // Cache for presence snapshots — written once per join, read per flush.
      this.sockets.setUserMeta(userId, {
        name: msg.user.name ?? null,
        avatar: msg.user.avatar ?? null,
      });

      this.sendToClient(ws, helloFrame(crypto.randomUUID()));
      this.markPresenceDirty();
    } else if (msg.t === "subscribe" && msg.topic) {
      this.handleWsSubscribe(ws, msg.topic);
    } else if (msg.t === "unsubscribe" && msg.topic) {
      this.handleWsUnsubscribe(ws, msg.topic);
    } else if (msg.t === "publish" && msg.topic) {
      await this.handleWsPublish(ws, userId, msg.topic, msg.data);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.ensureSubscribers();
    this.removeSocket(ws, "close");
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.ensureSubscribers();
    this.removeSocket(ws, "error");
  }

  // ── Socket bookkeeping ────────────────────────────────────────────

  /**
   * Drop a socket from every index. Idempotent, so a close handler racing an
   * eviction (or a duplicate runtime callback) cannot double-count.
   *
   * `close` is used for send failures: a socket that cannot be written to must
   * not stay in the fan-out index, otherwise every subsequent event retries it.
   */
  private removeSocket(ws: WebSocket, reason: "close" | "error" | "send-failed"): void {
    const userId = this.sockets.userId(ws);
    if (userId === undefined && !this.subscriptions.socketTopics(ws)) return;

    this.subscriptions.removeSocket(ws);
    const { lastSocketForUser } = this.sockets.untrack(ws);
    this.socketPublishLimit.release(ws);

    // Last socket for this user in this room — its shared budget goes too.
    if (userId !== undefined && lastSocketForUser) {
      this.userPublishLimit.release(userId);
    }

    this.metrics.connectionsClosed += 1;
    if (reason === "send-failed") {
      this.metrics.sendFailures += 1;
      try {
        ws.close(1011, "send failed");
      } catch {
        // Already closing/closed — nothing to do.
      }
    }
    this.markPresenceDirty();
  }

  // ── WebSocket message handlers ─────────────────────────────────────

  private handleWsSubscribe(ws: WebSocket, topic: string): void {
    // Idempotent: a duplicate subscribe frame (React remount, reconnect replay)
    // must not create a second subscription.
    this.subscriptions.add(topic, ws);

    // Update WebSocket attachment
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | undefined;
    if (attachment) {
      if (!attachment.topics.includes(topic)) {
        attachment.topics.push(topic);
      }
      ws.serializeAttachment(attachment);
    }
  }

  private handleWsUnsubscribe(ws: WebSocket, topic: string): void {
    this.subscriptions.remove(topic, ws);

    // Update WebSocket attachment
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | undefined;
    if (attachment) {
      attachment.topics = attachment.topics.filter((t) => t !== topic);
      ws.serializeAttachment(attachment);
    }
  }

  private async handleWsPublish(ws: WebSocket, userId: string, topic: string, data: unknown): Promise<void> {
    // This is the only way a member can inject data into a room, so it is the
    // security boundary: an explicit allow-list of client-publishable topics
    // and a minimal payload shape (client-publish.ts), evaluated BEFORE any
    // fan-out. Server-owned events never travel this path — they arrive over
    // the secret-authenticated POST /publish handler below.
    const decision = guardClientPublish(topic, data, {
      userId,
      name: this.sockets.getUserMeta(userId)?.name,
    });
    if (!decision.ok) {
      if (decision.reason === "topic") this.metrics.clientPublishRejectedTopic += 1;
      else this.metrics.clientPublishRejectedPayload += 1;
      return;
    }

    // Only a socket subscribed to the topic may publish into it.
    if (!this.subscriptions.socketTopics(ws)?.has(topic)) return;

    // One bucket per socket (a tab cannot flood) and one per user across all
    // their sockets/devices (many tabs cannot flood together). A socket that is
    // already over its own budget does not consume the user's shared budget.
    const now = Date.now();
    if (!this.socketPublishLimit.allow(ws, now) || !this.userPublishLimit.allow(userId, now)) {
      this.metrics.clientPublishRateLimited += 1;
      return;
    }

    this.metrics.clientPublishesAccepted += 1;

    // Broadcast to all subscribers (sender excluded) — the guarded payload, not
    // the client's object.
    this.broadcastByTopic(topic, decision.data, userId, userId);
  }

  // ── Subscriber index reconstruction after hibernation ────────────────

  /**
   * Idempotent: rebuilds socket + user maps from hibernated attachments once.
   * The constructor wraps the first call in blockConcurrencyWhile; later
   * callers (message/close/publish/upgrade) just await the shared promise.
   */
  private ensureSubscribers(): Promise<void> {
    if (this.reconstructed) return Promise.resolve();
    if (!this.reconstructPromise) {
      this.reconstructPromise = Promise.resolve()
        .then(() => {
          for (const ws of this.ctx.getWebSockets()) {
            this.adoptSocket(ws);
          }
          this.reconstructed = true;
        })
        .finally(() => {
          this.reconstructPromise = null;
        });
    }
    return this.reconstructPromise;
  }

  /**
   * Register a single accepted socket from its hibernation attachment and index
   * its topics. Returns the userId, or null if the socket carries no usable
   * attachment.
   */
  private adoptSocket(ws: WebSocket): string | null {
    const adopted = this.sockets.adopt(ws);
    if (!adopted) return null;

    for (const topic of adopted.topics) {
      this.subscriptions.add(topic, ws);
    }

    return adopted.userId;
  }

  // ── HTTP publish (server-side) ───────────────────────────────────────

  private async publish(request: Request): Promise<Response> {
    const body = await readPublishRequest(request);
    if (!body) {
      return new Response("Bad request", { status: 400 });
    }

    // Idempotency: a retried publish reuses its `event_id`, so an event that
    // already reached this room is acknowledged rather than broadcast twice.
    if (body.event_id) {
      if (!this.publishedEventIds.accept(body.event_id)) {
        this.metrics.duplicateDeliveriesSuppressed += 1;
        return new Response("ok");
      }
    }

    await this.ensureSubscribers();
    this.metrics.eventsPublished += 1;
    this.broadcastByTopic(body.topic, body.data, body.exclude_user);

    return new Response("ok");
  }

  // ── Broadcast with targeted fan-out ─────────────────────────────────

  /**
   * Send an event to the sockets subscribed to `topic` — and only those.
   *
   * Cost is O(recipients), not O(sockets in the DO): the subscriber set is read
   * directly from the topic index instead of scanning every attached socket.
   * The payload is serialized once per broadcast.
   */
  private broadcastByTopic(
    topic: string,
    data: unknown,
    excludeUserId?: string,
    senderUserId?: string,
  ): void {
    const recipients = this.subscriptions.subscribers(topic);
    if (!recipients || recipients.size === 0) return;

    this.metrics.fanoutRecipients += recipients.size;

    const eventMsg = encodeEventFrame({
      room: this.roomName(),
      topic,
      data,
      sender: senderUserId,
    });
    const eventBytes = eventMsg.length;

    for (const ws of recipients) {
      const userId = this.sockets.userId(ws);
      if (!userId) continue;
      if (excludeUserId && userId === excludeUserId) continue;

      this.metrics.deliverAttempts += 1;
      try {
        ws.send(eventMsg);
        this.metrics.eventPayloadBytes += eventBytes;
      } catch {
        // One broken socket must not affect the rest of the fan-out, and it
        // must not be retried on every subsequent event — evict it now.
        this.removeSocket(ws, "send-failed");
      }
    }
  }

  // ── Presence ──────────────────────────────────────────────────────

  /** Mark presence as changed and schedule a coalesced flush. */
  private markPresenceDirty(): void {
    this.presence.markPresenceDirty();
  }

  // ── Room helpers ────────────────────────────────────────────────────

  private roomName(): string {
    return this.ctx.id.name ?? this.ctx.id.toString();
  }

  private communityIdFromRoom(): string {
    const name = this.roomName();
    const idx = name.indexOf(":");
    return idx >= 0 ? name.slice(idx + 1) : name;
  }

  private sendToClient(ws: WebSocket, msg: unknown): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      this.removeSocket(ws, "send-failed");
    }
  }
}
