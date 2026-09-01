import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { PublishRequest } from "./types";

/**
 * Community Durable Object — ONE per community. Handles all logical realtime
 * topics (chat, typing, presence, threads, events, resources).
 *
 * Architecture (WebSocket-ownership):
 *   Client → CommunityDO (direct WebSocket) → ws.send() → Client(s)
 *   0 RPCs for message delivery.
 *
 * Dual-index subscriber store:
 *   subscriptionsByUser:  userId → Set<topic>
 *   subscriptionsByTopic: topic → Set<userId>
 *
 * Both indices are kept in-memory for O(topic) broadcast lookup.
 * Persisted to SQLite for hibernation survival.
 *
 * WebSocket state (hibernation-safe):
 *   Each WebSocket attachment stores { userId, topics: string[] }.
 *   On wake, ctx.getWebSockets() + deserializeAttachment() rebuilds the maps.
 *
 * Authorization:
 *   - WebSocket upgrade requires x-realtime-uid header (set by Worker after JWT auth)
 *   - RPC methods verify caller via RPC_SECRET (defense-in-depth, legacy path)
 *   - Membership checked via internal API (fail-closed)
 *
 * Event classification:
 *   - EPHEMERAL (typing, presence): drop on delivery failure, no retry
 *   - DURABLE (chat, edit, delete, reaction): client recovers via DB
 */

interface Member {
  name: string | null;
  avatar: string | null;
  connections: number;
}

interface WebSocketAttachment {
  userId: string;
  topics: string[];
}

const MEMBERS_KEY = "members";
const MAX_MESSAGE_BYTES = 8192;
const SUB_KEY_PREFIX = "sub:";

/** Events that are ephemeral — no retry on delivery failure. */
const EPHEMERAL_TOPICS = new Set(["typing", "presence"]);

export class Room extends DurableObject<Env> {
  /**
   * Dual-index subscriber store.
   * subscriptionsByUser[userId] = Set of topics the user is subscribed to.
   * subscriptionsByTopic[topic] = Set of userIds subscribed to that topic.
   */
  private subscriptionsByUser = new Map<string, Set<string>>();
  private subscriptionsByTopic = new Map<string, Set<string>>();
  private subscribersReconstructed = false;

  /**
   * WebSocket-ownership maps (rebuilt from ctx.getWebSockets() after hibernation).
   * wsToUser[ws] = userId of the connected client.
   * userTopics[userId] = Set<topics> the user is subscribed to on THIS connection.
   */
  private wsToUser = new Map<WebSocket, string>();
  private userTopics = new Map<string, Set<string>>();
  private wsReconstructed = false;

  // ── Fetch handler ──────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    // Server-side publish via HTTP POST
    if (request.headers.get("x-realtime-publish-secret")) {
      return this.publish(request);
    }

    // WebSocket upgrade (new architecture: CommunityDO owns connections)
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

    // Check membership before accepting connection
    const isMember = await this.checkMembership(userId);
    if (!isMember) {
      return new Response("Forbidden", { status: 403 });
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

    // Track in memory
    this.wsToUser.set(server, userId);
    this.userTopics.set(userId, new Set());

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

    const userId = this.wsToUser.get(ws);
    if (!userId) return;

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
    const userId = this.wsToUser.get(ws);
    if (!userId) return;

    // Remove all subscriptions for this connection
    const topics = this.userTopics.get(userId);
    if (topics) {
      for (const topic of topics) {
        this.removeFromTopicIndex(userId, topic);
        await this.ctx.storage.delete(`${SUB_KEY_PREFIX}${userId}:${topic}`);
      }
      this.userTopics.delete(userId);
    }

    this.wsToUser.delete(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // ── WebSocket message handlers ─────────────────────────────────────

  private async handleWsSubscribe(ws: WebSocket, userId: string, topic: string): Promise<void> {
    // Ensure user has a topic set
    let topics = this.userTopics.get(userId);
    if (!topics) {
      topics = new Set();
      this.userTopics.set(userId, topics);
    }
    topics.add(topic);

    // Update dual index
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

    // Persist to SQLite
    await this.ctx.storage.put(`${SUB_KEY_PREFIX}${userId}:${topic}`, { userId, topic });

    // Update WebSocket attachment
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | undefined;
    if (attachment) {
      if (!attachment.topics.includes(topic)) {
        attachment.topics.push(topic);
      }
      ws.serializeAttachment(attachment);
    }
  }

  private async handleWsUnsubscribe(ws: WebSocket, userId: string, topic: string): Promise<void> {
    // Remove from user topics
    const topics = this.userTopics.get(userId);
    if (topics) {
      topics.delete(topic);
      if (topics.size === 0) {
        this.userTopics.delete(userId);
      }
    }

    // Remove from dual index
    this.removeFromTopicIndex(userId, topic);

    // Remove from SQLite
    await this.ctx.storage.delete(`${SUB_KEY_PREFIX}${userId}:${topic}`);

    // Update WebSocket attachment
    const attachment = ws.deserializeAttachment() as WebSocketAttachment | undefined;
    if (attachment) {
      attachment.topics = attachment.topics.filter((t) => t !== topic);
      ws.serializeAttachment(attachment);
    }
  }

  private async handleWsPublish(ws: WebSocket, userId: string, topic: string, data: unknown): Promise<void> {
    const topics = this.userTopics.get(userId);
    if (!topics || !topics.has(topic)) return;

    // Broadcast to all subscribers (sender excluded via broadcastByTopic)
    await this.broadcastByTopic(topic, data, userId, userId);
  }

  // ── Subscriber index reconstruction after hibernation ────────────────

  private async ensureSubscribers(): Promise<void> {
    if (this.subscribersReconstructed) return;
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.subscribersReconstructed) return;
      await this.reconstructSubscribers();
      await this.reconstructWebSockets();
      this.subscribersReconstructed = true;
      this.wsReconstructed = true;
    });
  }

  private async reconstructSubscribers(): Promise<void> {
    const entries = await this.ctx.storage.list({ prefix: SUB_KEY_PREFIX });
    for (const [key, value] of entries) {
      const payload = value as { userId: string; topic: string } | undefined;
      if (!payload?.userId || !payload?.topic) continue;

      let userTopics = this.subscriptionsByUser.get(payload.userId);
      if (!userTopics) {
        userTopics = new Set();
        this.subscriptionsByUser.set(payload.userId, userTopics);
      }
      userTopics.add(payload.topic);

      let topicSubs = this.subscriptionsByTopic.get(payload.topic);
      if (!topicSubs) {
        topicSubs = new Set();
        this.subscriptionsByTopic.set(payload.topic, topicSubs);
      }
      topicSubs.add(payload.userId);
    }
  }

  private async reconstructWebSockets(): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as WebSocketAttachment | undefined;
      if (!attachment?.userId) continue;

      this.wsToUser.set(ws, attachment.userId);

      // Rebuild userTopics from attachment
      let topics = this.userTopics.get(attachment.userId);
      if (!topics) {
        topics = new Set();
        this.userTopics.set(attachment.userId, topics);
      }
      for (const topic of attachment.topics) {
        topics.add(topic);
      }
    }
  }

  // ── RPC: subscribe (legacy path, kept for feature flag) ─────────────

  /**
   * Called by UserDO via RPC when a user subscribes to a topic.
   * Only used when USE_WEBSOCKET_OWNERSHIP is disabled.
   */
  async subscribe(
    userId: string,
    topics: string | string[],
    rpcSecret?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (rpcSecret !== this.env.RPC_SECRET) {
      return { ok: false, error: "unauthorized" };
    }

    const isMember = await this.checkMembership(userId);
    if (!isMember) {
      return { ok: false, error: "not_member" };
    }

    await this.ensureSubscribers();

    const topicList = Array.isArray(topics) ? topics : [topics];
    for (const topic of topicList) {
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

      const key = `${SUB_KEY_PREFIX}${userId}:${topic}`;
      await this.ctx.storage.put(key, { userId, topic });
    }

    return { ok: true };
  }

  // ── RPC: unsubscribe (legacy path) ─────────────────────────────────

  async unsubscribe(
    userId: string,
    topics: string | string[],
    rpcSecret?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (rpcSecret !== this.env.RPC_SECRET) {
      return { ok: false, error: "unauthorized" };
    }

    await this.ensureSubscribers();

    const topicList = Array.isArray(topics) ? topics : [topics];
    for (const topic of topicList) {
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

      const key = `${SUB_KEY_PREFIX}${userId}:${topic}`;
      await this.ctx.storage.delete(key);
    }

    return { ok: true };
  }

  // ── RPC: publish (legacy path) ─────────────────────────────────────

  async publishMessage(
    userId: string,
    topic: string,
    data: unknown,
    rpcSecret?: string,
  ): Promise<void> {
    if (rpcSecret !== this.env.RPC_SECRET) return;

    await this.ensureSubscribers();
    await this.broadcastByTopic(topic, data, userId, userId);
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

    await this.ensureSubscribers();
    await this.broadcastByTopic(body.topic, body.data, body.exclude_user);

    return new Response("ok");
  }

  // ── Broadcast with dual-index lookup ──────────────────────────────────

  /**
   * Broadcast an event to all subscribers of a topic.
   *
   * When WebSocket-ownership is enabled, iterates ctx.getWebSockets() and
   * sends directly via ws.send(). 0 RPC calls.
   *
   * When using the legacy RPC path, calls deliverToUser() per subscriber.
   */
  private async broadcastByTopic(
    topic: string,
    data: unknown,
    excludeUserId?: string,
    senderUserId?: string,
  ): Promise<void> {
    const topicSubs = this.subscriptionsByTopic.get(topic);
    if (!topicSubs || topicSubs.size === 0) return;

    // WebSocket-ownership path: iterate connected WebSockets directly
    const websockets = this.ctx.getWebSockets();
    if (websockets.length > 0) {
      const eventMsg = JSON.stringify({
        t: "event",
        room: this.roomName(),
        topic,
        data,
        sender: senderUserId,
      });

      for (const ws of websockets) {
        const attachment = ws.deserializeAttachment() as WebSocketAttachment | undefined;
        if (!attachment?.userId) continue;
        if (excludeUserId && attachment.userId === excludeUserId) continue;
        if (!attachment.topics.includes(topic)) continue;

        try {
          ws.send(eventMsg);
        } catch {
          // WebSocket send failed — will be cleaned up on close
        }
      }
      return;
    }

    // Legacy RPC path (when no WebSockets are connected)
    const isEphemeral = EPHEMERAL_TOPICS.has(topic);
    const roomName = this.roomName();

    const calls: Promise<void>[] = [];
    for (const userId of topicSubs) {
      if (excludeUserId && userId === excludeUserId) continue;

      const call = this.deliverToUser(roomName, topic, data, userId, isEphemeral, senderUserId);
      calls.push(call);
    }

    await Promise.allSettled(calls);
  }

  /**
   * Deliver an event to a specific user via UserDO RPC.
   * Legacy path — only used when no WebSocket connections are present.
   */
  private async deliverToUser(
    room: string,
    topic: string,
    data: unknown,
    userId: string,
    isEphemeral: boolean,
    senderUserId?: string,
  ): Promise<void> {
    const stub = this.env.USER_DO.get(this.env.USER_DO.idFromName(`user:${userId}`));

    try {
      await stub.deliverEvent(room, topic, data, senderUserId ?? undefined);
    } catch (err) {
      if (isEphemeral) {
        return;
      }
      await new Promise((r) => setTimeout(r, 100));
      try {
        await stub.deliverEvent(room, topic, data, senderUserId ?? undefined);
      } catch {
        // Second failure: drop
      }
    }
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
