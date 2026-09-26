import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { PublishRequest } from "./types";
import { RealtimeMetrics } from "./metrics";
import {
  TopicSocketIndex,
  buildPresenceSnapshot,
  presenceSignature,
  type PresenceMeta,
} from "./subscriptions";

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
 *     wsToUser[ws]        = userId
 *     subscriptions       = topic → sockets (targeted fan-out index)
 *   USER-scoped (multi-device bookkeeping + presence):
 *     userSockets[userId] = Set<WebSocket> all sockets for this user
 *     userMeta[userId]    = { name, avatar } cached at join() so a presence
 *                           snapshot never has to deserialize attachments
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
 *
 * Event classification:
 *   - EPHEMERAL (typing, presence): drop on delivery failure, no retry
 *   - DURABLE (chat, edit, delete, reaction): client recovers via DB
 */

interface WebSocketAttachment {
  userId: string;
  topics: string[];
  name: string | null;
  avatar: string | null;
}

/**
 * How long presence changes are allowed to coalesce.
 *
 * Presence is a coarse "who is here" roster: a 150 ms delay is imperceptible,
 * while sending a full snapshot on every join/close made a reconnect storm
 * quadratic (N connections joining produced N snapshots × N sockets).
 */
const PRESENCE_COALESCE_MS = 150;

/** Membership re-check window and the cap on cached entries. */
const MEMBERSHIP_CACHE_TTL_MS = 60_000;
const MEMBERSHIP_CACHE_MAX_ENTRIES = 500;
/** Sweep expired `auth:*` storage keys every N membership API checks. */
const MEMBERSHIP_STORAGE_PRUNE_EVERY = 64;

export class Room extends DurableObject<Env> {
  /**
   * Targeted fan-out index: topic → sockets that subscribed to it.
   * This is the only structure a broadcast reads.
   */
  private subscriptions = new TopicSocketIndex<WebSocket>();

  /** Socket → userId, and userId → its sockets (multi-device + presence). */
  private wsToUser = new Map<WebSocket, string>();
  private userSockets = new Map<string, Set<WebSocket>>();
  /** Display metadata cached at join() — presence snapshots never touch attachments. */
  private userMeta = new Map<string, PresenceMeta>();

  /** In-flight reconstruction, shared so concurrent callers await the same work. */
  private reconstructPromise: Promise<void> | null = null;
  private reconstructed = false;

  /** Coalesced presence state. */
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceDirty = false;
  private lastPresenceSignature: string | null = null;

  /** Bounded membership authorization cache (in-memory LRU + pruned storage). */
  private membershipCache = new Map<string, { ok: boolean; ts: number }>();
  private membershipStorageWrites = 0;

  readonly metrics = new RealtimeMetrics();

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
      sockets: this.wsToUser.size,
      users: this.userSockets.size,
      topics: this.subscriptions.topicCount,
      subscriptionRefs: this.subscriptions.referenceCount,
      membershipCacheSize: this.membershipCache.size,
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
    const attachment: WebSocketAttachment = {
      userId,
      topics: [],
      name: null,
      avatar: null,
    };
    server.serializeAttachment(attachment);

    this.trackSocket(server, userId);
    this.metrics.connectionsOpened += 1;
    // A new socket changes the presence roster (it joins as "unknown" until its
    // `join` frame lands, exactly like the previous snapshot did).
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

    let userId: string | undefined = this.wsToUser.get(ws);
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
      this.userMeta.set(userId, {
        name: msg.user.name ?? null,
        avatar: msg.user.avatar ?? null,
      });

      this.sendToClient(ws, { t: "hello", connectionId: crypto.randomUUID() });
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

  /** Register an accepted socket in the socket- and user-scoped maps. */
  private trackSocket(ws: WebSocket, userId: string): void {
    this.wsToUser.set(ws, userId);

    let sockets = this.userSockets.get(userId);
    if (!sockets) {
      sockets = new Set();
      this.userSockets.set(userId, sockets);
    }
    sockets.add(ws);
  }

  /**
   * Drop a socket from every index. Idempotent, so a close handler racing an
   * eviction (or a duplicate runtime callback) cannot double-count.
   *
   * `close` is used for send failures: a socket that cannot be written to must
   * not stay in the fan-out index, otherwise every subsequent event retries it.
   */
  private removeSocket(ws: WebSocket, reason: "close" | "error" | "send-failed"): void {
    const userId = this.wsToUser.get(ws);
    if (userId === undefined && !this.subscriptions.socketTopics(ws)) return;

    this.subscriptions.removeSocket(ws);
    this.wsToUser.delete(ws);

    if (userId !== undefined) {
      const sockets = this.userSockets.get(userId);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) {
          this.userSockets.delete(userId);
          this.userMeta.delete(userId);
        }
      }
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
    // Only a socket subscribed to the topic may publish into it.
    if (!this.subscriptions.socketTopics(ws)?.has(topic)) return;

    // Broadcast to all subscribers (sender excluded).
    this.broadcastByTopic(topic, data, userId, userId);
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
   * Register a single accepted socket in the socket-scoped and user-scoped
   * maps using its hibernation attachment. Returns the userId, or null if the
   * socket carries no usable attachment.
   */
  private adoptSocket(ws: WebSocket): string | null {
    let attachment: WebSocketAttachment | undefined;
    try {
      attachment = ws.deserializeAttachment() as WebSocketAttachment | undefined;
    } catch {
      return null;
    }
    if (!attachment?.userId) return null;

    const userId = attachment.userId;
    this.trackSocket(ws, userId);

    for (const topic of attachment.topics ?? []) {
      this.subscriptions.add(topic, ws);
    }

    if (attachment.name !== undefined || attachment.avatar !== undefined) {
      this.userMeta.set(userId, {
        name: attachment.name ?? null,
        avatar: attachment.avatar ?? null,
      });
    }

    return userId;
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

    const eventMsg = JSON.stringify({
      t: "event",
      room: this.roomName(),
      topic,
      data,
      sender: senderUserId,
    });

    for (const ws of recipients) {
      const userId = this.wsToUser.get(ws);
      if (!userId) continue;
      if (excludeUserId && userId === excludeUserId) continue;

      this.metrics.deliverAttempts += 1;
      try {
        ws.send(eventMsg);
      } catch {
        // One broken socket must not affect the rest of the fan-out, and it
        // must not be retried on every subsequent event — evict it now.
        this.removeSocket(ws, "send-failed");
      }
    }
  }

  // ── Presence ──────────────────────────────────────────────────────

  /**
   * Mark the roster as changed and schedule a flush.
   *
   * Joins and closes are coalesced into one snapshot per window: before this, a
   * reconnect storm sent a full snapshot (with an attachment deserialization
   * per socket, twice) for every single join and close.
   */
  private markPresenceDirty(): void {
    this.presenceDirty = true;
    if (this.presenceTimer !== null) {
      this.metrics.presenceCoalesced += 1;
      return;
    }
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      this.flushPresence();
    }, PRESENCE_COALESCE_MS);
  }

  /** Broadcast one entry per connected member, with tabs/devices folded into connections. */
  private flushPresence(): void {
    if (!this.presenceDirty) return;
    this.presenceDirty = false;

    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;

    const users = buildPresenceSnapshot(this.userSockets, this.userMeta);
    const signature = presenceSignature(users);
    // Nothing changed since the last snapshot — skip the write entirely.
    if (signature === this.lastPresenceSignature) {
      this.metrics.presenceSkipped += 1;
      return;
    }
    this.lastPresenceSignature = signature;

    const message = JSON.stringify({
      t: "presence",
      room: this.roomName(),
      users,
    });

    for (const ws of sockets) {
      // Counted separately from event fan-out: this addresses the whole room, so
      // folding it into `deliverAttempts` would hide the cost of a publish.
      this.metrics.presenceDeliverAttempts += 1;
      try {
        ws.send(message);
      } catch {
        // A dead socket is evicted; the next flush publishes a fresh snapshot.
        this.removeSocket(ws, "send-failed");
      }
    }
    this.metrics.presenceBroadcasts += 1;
  }

  // ── Membership authorization (fail-closed) ──────────────────────────

  private async checkMembership(userId: string): Promise<boolean> {
    if (!this.env.API_URL) return true;

    const communityId = this.communityIdFromRoom();
    const cacheKey = `${communityId}:${userId}`;

    const cached = this.membershipCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < MEMBERSHIP_CACHE_TTL_MS) {
      this.metrics.membershipCacheHits += 1;
      // Refresh LRU position: the cache is capped, so a hot community with
      // thousands of connecting members must not evict its own active set.
      this.membershipCache.delete(cacheKey);
      this.membershipCache.set(cacheKey, cached);
      return cached.ok;
    }
    if (cached) this.membershipCache.delete(cacheKey);

    try {
      const stored = await this.ctx.storage.get<{ ok: boolean; ts: number }>(`auth:${cacheKey}`);
      if (
        stored &&
        typeof stored.ok === "boolean" &&
        typeof stored.ts === "number" &&
        Date.now() - stored.ts < MEMBERSHIP_CACHE_TTL_MS
      ) {
        this.setMembershipCache(cacheKey, stored);
        this.metrics.membershipCacheHits += 1;
        return stored.ok;
      }
    } catch {
      // Storage read failed — fall through to the authoritative API check.
    }

    this.metrics.membershipChecks += 1;
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

      this.setMembershipCache(cacheKey, { ok: authorized, ts: Date.now() });

      try {
        await this.ctx.storage.put(`auth:${cacheKey}`, {
          ok: authorized,
          ts: Date.now(),
        });
        this.membershipStorageWrites += 1;
        if (this.membershipStorageWrites % MEMBERSHIP_STORAGE_PRUNE_EVERY === 0) {
          // Storage entries are only useful inside the TTL; without a sweep a
          // large community accumulated one permanent key per member forever.
          await this.pruneMembershipStorage();
        }
      } catch {
        // Storage write failed — not critical
      }

      return authorized;
    } catch {
      this.membershipCache.delete(cacheKey);
      return false;
    }
  }

  /** Insert into the bounded cache, evicting the oldest entry past the cap. */
  private setMembershipCache(cacheKey: string, value: { ok: boolean; ts: number }): void {
    this.membershipCache.delete(cacheKey);
    this.membershipCache.set(cacheKey, value);
    while (this.membershipCache.size > MEMBERSHIP_CACHE_MAX_ENTRIES) {
      const oldest = this.membershipCache.keys().next().value;
      if (oldest === undefined) break;
      this.membershipCache.delete(oldest);
      this.metrics.membershipCacheEvictions += 1;
    }
  }

  /** Delete expired `auth:*` keys (bounded page — the sweep repeats next cycle). */
  private async pruneMembershipStorage(): Promise<void> {
    try {
      const now = Date.now();
      const entries = await this.ctx.storage.list<{ ok: boolean; ts: number }>({
        prefix: "auth:",
        limit: 256,
      });
      const expired: string[] = [];
      for (const [key, value] of entries) {
        const ts = typeof value?.ts === "number" ? value.ts : 0;
        if (now - ts >= MEMBERSHIP_CACHE_TTL_MS) expired.push(key);
      }
      if (expired.length > 0) await this.ctx.storage.delete(expired);
    } catch {
      // Maintenance only — never fail a connection because cleanup failed.
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
      this.removeSocket(ws, "send-failed");
    }
  }
}
