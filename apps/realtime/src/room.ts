import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { PublishRequest } from "./types";

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
 *     wsToUser[ws]   = userId
 *     wsTopics[ws]    = Set<topics> this socket is subscribed to
 *     userSockets[userId] = Set<WebSocket> all sockets for this user
 *
 *   USER-scoped (for efficient fan-out, shared across all sockets of a user):
 *     subscriptionsByUser[userId]  = Set<topics> (union of all socket subscriptions)
 *     subscriptionsByTopic[topic]  = Set<userIds> subscribed to that topic
 *
 * Multi-device safety:
 *   When the same user has multiple sockets, closing one socket only removes
 *   topics from the dual-index if NO OTHER socket of that user still has
 *   that topic. This prevents one tab's close from killing another tab's
 *   subscriptions.
 *
 * WebSocket state (hibernation-safe):
 *   Each WebSocket attachment stores { userId, topics: string[] }.
 *   On wake, ctx.getWebSockets() + deserializeAttachment() rebuilds all maps.
 *
 * Authorization:
 *   - WebSocket upgrade requires x-realtime-uid header (set by Worker after JWT auth)
 *   - Membership checked via internal API (fail-closed)
 *
 * Event classification:
 *   - EPHEMERAL (typing, presence): drop on delivery failure, no retry
 *   - DURABLE (chat, edit, delete, reaction): client recovers via DB
 */

interface WebSocketAttachment {
  userId: string;
  topics: string[];
}

export class Room extends DurableObject<Env> {
  /**
   * Dual-index subscriber store (USER-scoped, for efficient fan-out).
   * subscriptionsByUser[userId] = Set of topics the user is subscribed to (across all sockets).
   * subscriptionsByTopic[topic] = Set of userIds subscribed to that topic.
   */
  private subscriptionsByUser = new Map<string, Set<string>>();
  private subscriptionsByTopic = new Map<string, Set<string>>();
  private subscribersReconstructed = false;

  /**
   * WebSocket-ownership maps (SOCKET-scoped, rebuilt after hibernation).
   * wsToUser[ws]     = userId of the connected client.
   * wsTopics[ws]     = Set<topics> this SPECIFIC socket is subscribed to.
   * userSockets[userId] = Set<WebSocket> all active sockets for this user.
   */
  private wsToUser = new Map<WebSocket, string>();
  private wsTopics = new Map<WebSocket, Set<string>>();
  private userSockets = new Map<string, Set<WebSocket>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Rebuild socket/topic maps BEFORE any handler runs after a hibernation
    // wake. Without this, the first event delivered to a woken DO is often a
    // `webSocketMessage` (e.g. a typing publish), and wsToUser/wsTopics are
    // empty → the message is silently dropped and the sender is treated as
    // unknown. blockConcurrencyWhile guarantees ordering for all handlers.
    this.ctx.blockConcurrencyWhile(async () => {
      await this.reconstructWebSockets();
      this.rebuildUserScopedMaps();
      this.subscribersReconstructed = true;
    });
  }

  // ── Fetch handler ──────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
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

  // ── WebSocket lifecycle (hibernation-safe) ─────────────────────────

  private async upgrade(request: Request): Promise<Response> {
    const userId = request.headers.get("x-realtime-uid");
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    console.log(`[SRV-DIAG] UPGRADE userId=${userId} room=${this.roomName()}`);

    // Check membership before accepting connection.
    // Sub-entity rooms (thread-comments:*, resource-comments:*) don't carry a
    // community ID in the room name, so skip the check — authorization is
    // handled by the API routes that publish to these rooms.
    const room = this.roomName();
    const isSubEntityRoom = room.startsWith("thread-comments:") || room.startsWith("resource-comments:");
    if (!isSubEntityRoom) {
      const isMember = await this.checkMembership(userId);
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
    const attachment: WebSocketAttachment = { userId, topics: [] };
    server.serializeAttachment(attachment);

    // Track in memory — socket-scoped state
    this.wsToUser.set(server, userId);
    this.wsTopics.set(server, new Set());

    // Track this socket under the user (for multi-device cleanup)
    let sockets = this.userSockets.get(userId);
    if (!sockets) {
      sockets = new Set();
      this.userSockets.set(userId, sockets);
    }
    sockets.add(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    await this.ensureSubscribers();

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

    const userId = this.wsToUser.get(ws);
    if (!userId) return;

    if (msg.t === "subscribe" || msg.t === "publish") {
      console.log(`[SRV-DIAG] RECV userId=${userId} type=${msg.t} topic=${msg.topic}`);
    }

    if (msg.t === "join") {
      if (!msg.user || msg.user.id !== userId) return;
      this.sendToClient(ws, { t: "hello", connectionId: crypto.randomUUID() });
    } else if (msg.t === "subscribe" && msg.topic) {
      await this.handleWsSubscribe(ws, userId, msg.topic);
    } else if (msg.t === "unsubscribe" && msg.topic) {
      await this.handleWsUnsubscribe(ws, userId, msg.topic);
    } else if (msg.t === "publish" && msg.topic) {
      await this.handleWsPublish(ws, userId, msg.topic, msg.data);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.ensureSubscribers();
    const userId = this.wsToUser.get(ws);
    if (!userId) return;

    // Remove this socket's subscriptions from the dual-index
    // Only remove from dual-index if NO OTHER socket of this user still has this topic
    const topics = this.wsTopics.get(ws);
    console.log(`[SRV-DIAG] WS_CLOSE userId=${userId} socketTopics=[${topics ? [...topics].join(",") : "NONE"}]`);
    if (topics) {
      const otherSockets = this.userSockets.get(userId);
      for (const topic of topics) {
        // Check if any OTHER socket of this user still subscribes to this topic
        let stillSubscribed = false;
        if (otherSockets) {
          for (const otherWs of otherSockets) {
            if (otherWs === ws) continue;
            const otherTopics = this.wsTopics.get(otherWs);
            if (otherTopics?.has(topic)) {
              stillSubscribed = true;
              break;
            }
          }
        }
        if (!stillSubscribed) {
          this.removeFromTopicIndex(userId, topic);
        }
      }
      this.wsTopics.delete(ws);
    }

    // Remove this socket from the user's socket set
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      sockets.delete(ws);
      if (sockets.size === 0) {
        this.userSockets.delete(userId);
      }
    }

    this.wsToUser.delete(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // ── WebSocket message handlers ─────────────────────────────────────

  private async handleWsSubscribe(ws: WebSocket, userId: string, topic: string): Promise<void> {
    // Add topic to this socket's topic set
    let topics = this.wsTopics.get(ws);
    if (!topics) {
      topics = new Set();
      this.wsTopics.set(ws, topics);
    }
    const had = topics.has(topic);
    topics.add(topic);

    // Update dual index (user-scoped, for fan-out)
    let userTopics = this.subscriptionsByUser.get(userId);
    if (!userTopics) {
      userTopics = new Set();
      this.subscriptionsByUser.set(userId, userTopics);
    }
    userTopics.add(topic);

    let topicSubs = this.subscriptionsByTopic.get(topic);
    if (!topicSubs) {
      topicSubs = new Set();
      this.subscriptionsByTopic.set(topic, topicSubs);
    }
    topicSubs.add(userId);

    // Update WebSocket attachment
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | undefined;
    if (attachment) {
      if (!attachment.topics.includes(topic)) {
        attachment.topics.push(topic);
      }
      ws.serializeAttachment(attachment);
    }

    console.log(`[SRV-DIAG] SUBSCRIBE userId=${userId} topic=${topic} had=${had} socketTopics=[${[...topics].join(",")}]`);
  }

  private async handleWsUnsubscribe(ws: WebSocket, userId: string, topic: string): Promise<void> {
    // Remove topic from this socket's topic set
    const topics = this.wsTopics.get(ws);
    if (topics) {
      topics.delete(topic);
    }

    // Check if any OTHER socket of this user still has this topic
    let stillSubscribed = false;
    const sockets = this.userSockets.get(userId);
    if (sockets) {
      for (const otherWs of sockets) {
        if (otherWs === ws) continue;
        const otherTopics = this.wsTopics.get(otherWs);
        if (otherTopics?.has(topic)) {
          stillSubscribed = true;
          break;
        }
      }
    }

    // Only remove from dual-index if no other socket has this topic
    if (!stillSubscribed) {
      this.removeFromTopicIndex(userId, topic);
    }

    // Update WebSocket attachment
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | undefined;
    if (attachment) {
      attachment.topics = attachment.topics.filter((t) => t !== topic);
      ws.serializeAttachment(attachment);
    }
  }

  private async handleWsPublish(ws: WebSocket, userId: string, topic: string, data: unknown): Promise<void> {
    // Check if THIS socket is subscribed to the topic
    const topics = this.wsTopics.get(ws);
    const hasTopic = topics?.has(topic) ?? false;
    const eid = typeof data === "object" && data !== null ? (data as Record<string, unknown>).eid : undefined;
    console.log(`[SRV-DIAG] PUBLISH userId=${userId} topic=${topic} hasTopic=${hasTopic} eid=${eid ?? "?"} socketTopics=[${topics ? [...topics].join(",") : "NONE"}]`);

    if (!hasTopic) {
      console.log(`[SRV-DIAG] PUBLISH_DROPPED userId=${userId} topic=${topic} eid=${eid ?? "?"}`);
      return;
    }

    // Broadcast to all subscribers (sender excluded via broadcastByTopic)
    await this.broadcastByTopic(topic, data, userId, userId);
  }

  // ── Subscriber index reconstruction after hibernation ────────────────

  private async ensureSubscribers(): Promise<void> {
    if (this.subscribersReconstructed) return;
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.subscribersReconstructed) return;
      await this.reconstructWebSockets();
      this.rebuildUserScopedMaps();
      this.subscribersReconstructed = true;
    });
  }

  private async reconstructWebSockets(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as WebSocketAttachment | undefined;
      if (!attachment?.userId) continue;

      const userId = attachment.userId;

      // Rebuild socket-scoped state
      this.wsToUser.set(ws, userId);

      let topics = this.wsTopics.get(ws);
      if (!topics) {
        topics = new Set();
        this.wsTopics.set(ws, topics);
      }
      for (const topic of attachment.topics) {
        topics.add(topic);
      }

      // Rebuild user → sockets index
      let sockets = this.userSockets.get(userId);
      if (!sockets) {
        sockets = new Set();
        this.userSockets.set(userId, sockets);
      }
      sockets.add(ws);
    }
  }

  /**
   * Rebuild user-scoped dual-index maps from socket-scoped maps.
   * Called after reconstructWebSockets() to ensure subscriptionsByUser
   * and subscriptionsByTopic are consistent with connected WebSockets.
   * Subscription state lives in WebSocket attachments — no per-subscribe
   * storage writes needed.
   */
  private rebuildUserScopedMaps(): void {
    this.subscriptionsByUser.clear();
    this.subscriptionsByTopic.clear();

    for (const [ws, userId] of this.wsToUser) {
      const topics = this.wsTopics.get(ws);
      if (!topics) continue;

      let userTopics = this.subscriptionsByUser.get(userId);
      if (!userTopics) {
        userTopics = new Set();
        this.subscriptionsByUser.set(userId, userTopics);
      }
      for (const topic of topics) {
        userTopics.add(topic);
      }

      for (const topic of topics) {
        let topicSubs = this.subscriptionsByTopic.get(topic);
        if (!topicSubs) {
          topicSubs = new Set();
          this.subscriptionsByTopic.set(topic, topicSubs);
        }
        topicSubs.add(userId);
      }
    }
  }

  // ── HTTP publish (server-side) ───────────────────────────────────────

  private async publish(request: Request): Promise<Response> {
    let body: PublishRequest;
    try {
      body = (await request.json()) as PublishRequest;
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (!body.room || !body.topic) {
      return new Response("Bad request", { status: 400 });
    }

    console.log(`[SRV-DIAG] HTTP_PUBLISH topic=${body.topic} exclude_user=${body.exclude_user}`);
    await this.ensureSubscribers();
    await this.broadcastByTopic(body.topic, body.data, body.exclude_user);

    return new Response("ok");
  }

  // ── Broadcast with dual-index lookup ──────────────────────────────────

  /**
   * Broadcast an event to all subscribers of a topic.
   * Iterates ctx.getWebSockets() and sends directly via ws.send().
   * 0 RPC calls.
   */
  private async broadcastByTopic(
    topic: string,
    data: unknown,
    excludeUserId?: string,
    senderUserId?: string,
  ): Promise<void> {
    const topicSubs = this.subscriptionsByTopic.get(topic);
    if (!topicSubs || topicSubs.size === 0) {
      console.log(`[SRV-DIAG] BROADCAST topic=${topic} NO_SUBSCRIBERS`);
      return;
    }

    const eventMsg = JSON.stringify({
      t: "event",
      room: this.roomName(),
      topic,
      data,
      sender: senderUserId,
    });

    let sent = 0;
    let skipped = 0;
    for (const ws of this.ctx.getWebSockets()) {
      const userId = this.wsToUser.get(ws);
      if (!userId) continue;
      if (excludeUserId && userId === excludeUserId) continue;
      const socketTopics = this.wsTopics.get(ws);
      if (!socketTopics?.has(topic)) {
        skipped++;
        continue;
      }

      try {
        ws.send(eventMsg);
        sent++;
      } catch {
        // WebSocket send failed — will be cleaned up on close
      }
    }
    const eid = typeof data === "object" && data !== null ? (data as Record<string, unknown>).eid : undefined;
    console.log(`[SRV-DIAG] BROADCAST topic=${topic} eid=${eid ?? "?"} sent=${sent} skipped=${skipped} excludeUserId=${excludeUserId}`);
  }

  // ── Index helpers ──────────────────────────────────────────────────

  private removeFromTopicIndex(userId: string, topic: string): void {
    const userTopics = this.subscriptionsByUser.get(userId);
    if (userTopics) {
      userTopics.delete(topic);
      if (userTopics.size === 0) {
        this.subscriptionsByUser.delete(userId);
      }
    }

    const topicSubs = this.subscriptionsByTopic.get(topic);
    if (topicSubs) {
      topicSubs.delete(userId);
      if (topicSubs.size === 0) {
        this.subscriptionsByTopic.delete(topic);
      }
    }
  }

  // ── Membership authorization (fail-closed) ──────────────────────────

  /** Cache TTL: re-check membership every 60 seconds. */
  private static readonly MEMBERSHIP_CACHE_TTL_MS = 60_000;
  private membershipCache = new Map<string, { ok: boolean; ts: number }>();

  private async checkMembership(userId: string): Promise<boolean> {
    if (!this.env.API_URL) return true;

    const communityId = this.communityIdFromRoom();
    const cacheKey = `${communityId}:${userId}`;

    const cached = this.membershipCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < Room.MEMBERSHIP_CACHE_TTL_MS) {
      return cached.ok;
    }

    try {
      const response = await fetch(
        `${this.env.API_URL}/api/communities/${communityId}/members/${userId}/check`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${this.env.API_SECRET}`,
          },
          signal: AbortSignal.timeout(3000),
        },
      );

      let authorized = false;
      if (response.ok) {
        try {
          const body = await response.json() as { ok?: boolean };
          authorized = body.ok === true;
        } catch {
          authorized = false;
        }
      }

      this.membershipCache.set(cacheKey, { ok: authorized, ts: Date.now() });

      try {
        await this.ctx.storage.put(`auth:${cacheKey}`, {
          ok: authorized,
          ts: Date.now(),
        });
      } catch {
        // Storage write failed — not critical
      }

      return authorized;
    } catch {
      this.membershipCache.delete(cacheKey);
      return false;
    }
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
      /* ignore */
    }
  }
}
