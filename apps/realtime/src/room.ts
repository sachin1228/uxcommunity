import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { PublishRequest } from "./types";
import { RealtimeMetrics } from "./metrics";
import {
  PublishRateLimiter,
  SOCKET_PUBLISH_BURST,
  SOCKET_PUBLISH_REFILL_PER_SECOND,
  USER_PUBLISH_BURST,
  USER_PUBLISH_REFILL_PER_SECOND,
  guardClientPublish,
} from "./client-publish";
import {
  TopicSocketIndex,
  countOnlineUsers,
  type PresenceMeta,
} from "./subscriptions";
import { EventIdDedupe } from "./event-dedupe";
import { resolveMembershipConfig } from "./membership-config";
import { logEvent } from "./log";

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
 * Presence is a coarse online-member count: a 150 ms delay is imperceptible,
 * while flushing per join/close made a reconnect storm quadratic (N connections
 * produced N flushes × N sockets). Coalescing bounds the flush count; the count
 * payload bounds each flush.
 */
const PRESENCE_COALESCE_MS = 150;

/**
 * How many sockets one presence flush may write to.
 *
 * A count has to reach every attached socket, so a flush is inherently O(room)
 * work. Doing all of it inside one timer callback is what starved the Durable
 * Object in the H-3 5K ladder: at 4,351 attached sockets the flush wrote the
 * room back to back, the object could not interleave upgrades and queued `join`
 * frames with it (only 42 of 4,351 sockets ever got their `hello`), and the room
 * was lost.
 *
 * Capping the window bounds the work one presence change can impose on the
 * object. A room at or below the cap still delivers every change in a single
 * window — identical behaviour for normal-sized communities — and a larger room
 * rotates: the cursor advances by the cap each window (~150 ms), so a
 * 5,000-socket room converges on the current count within ~3 s.
 */
const PRESENCE_FLUSH_BUDGET = 256;

/**
 * One warn per isolate when membership authorization is unconfigured. Repeated
 * per-connection logs would be noise; the aggregate counter and this line are
 * enough for an operator to spot the misconfiguration.
 */
let warnedMissingMembershipApi = false;

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
  /** Display metadata cached at join() — client-publish frames never touch attachments. */
  private userMeta = new Map<string, PresenceMeta>();

  /** In-flight reconstruction, shared so concurrent callers await the same work. */
  private reconstructPromise: Promise<void> | null = null;
  private reconstructed = false;

  /** Coalesced presence state. */
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceDirty = false;
  /** Next socket index still owed the current count; 0 starts a lap. */
  private presenceCursor = 0;
  /** Last observed online count — how a change is noticed between flushes. */
  private presenceSeenCount: number | null = null;
  /** Count a finished clean lap proved to sit on every attached socket. */
  private presenceStableCount: number | null = null;
  /** Bumped whenever the observed count changes. */
  private presenceChangeSeq = 0;
  /** Change sequence and socket count captured when the current lap started. */
  private presenceLapChanges = 0;
  private presenceLapSockets = 0;

  /** Bounded membership authorization cache (in-memory LRU + pruned storage). */
  private membershipCache = new Map<string, { ok: boolean; ts: number }>();
  private membershipStorageWrites = 0;

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
    this.socketPublishLimit.release(ws);

    if (userId !== undefined) {
      const sockets = this.userSockets.get(userId);
      if (sockets) {
        sockets.delete(ws);
        if (sockets.size === 0) {
          this.userSockets.delete(userId);
          this.userMeta.delete(userId);
          // Last socket for this user in this room — its shared budget goes too.
          this.userPublishLimit.release(userId);
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
    // This is the only way a member can inject data into a room, so it is the
    // security boundary: an explicit allow-list of client-publishable topics
    // and a minimal payload shape (client-publish.ts), evaluated BEFORE any
    // fan-out. Server-owned events never travel this path — they arrive over
    // the secret-authenticated POST /publish handler below.
    const decision = guardClientPublish(topic, data, {
      userId,
      name: this.userMeta.get(userId)?.name,
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

    const eventMsg = JSON.stringify({
      t: "event",
      room: this.roomName(),
      topic,
      data,
      sender: senderUserId,
    });
    const eventBytes = eventMsg.length;

    for (const ws of recipients) {
      const userId = this.wsToUser.get(ws);
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

  /**
   * Mark presence as changed and schedule a flush.
   *
   * Joins and closes are coalesced into one count per window: before this, a
   * reconnect storm sent a message (with an attachment deserialization per
   * socket, twice) for every single join and close.
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

  /**
   * Send the room's online-member count to the next window of sockets.
   *
   * The payload is a single number by design (see `countOnlineUsers`): the only
   * presence consumer in the product renders "N online", so a roster added
   * nothing but bytes. The work per flush is capped at `PRESENCE_FLUSH_BUDGET`
   * sends (see that constant for why), so a room larger than the cap is told the
   * count one window at a time — a lap over the room — until every attached
   * socket holds it.
   *
   * A lap only proves delivery when neither the count nor the socket population
   * moved while it ran; a change landing mid-lap runs another lap instead of
   * declaring the room settled. The cursor is never reset, so a busy room keeps
   * advancing through its sockets rather than refreshing the same first window
   * on every change.
   */
  private flushPresence(): void {
    if (!this.presenceDirty) return;
    this.presenceDirty = false;

    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) {
      // Nothing to tell, and a socket that arrives later must be told afresh.
      this.presenceCursor = 0;
      this.presenceSeenCount = null;
      this.presenceStableCount = null;
      return;
    }

    const count = countOnlineUsers(this.userSockets);
    if (count !== this.presenceSeenCount) {
      this.presenceSeenCount = count;
      this.presenceChangeSeq += 1;
      this.metrics.presenceCountChanges += 1;
    }

    const startingLap = this.presenceCursor === 0;
    // Idle room: every socket holds this count and no lap is in progress.
    if (startingLap && count === this.presenceStableCount) {
      this.metrics.presenceSkipped += 1;
      return;
    }
    if (startingLap) {
      this.presenceLapChanges = this.presenceChangeSeq;
      this.presenceLapSockets = sockets.length;
    }

    const message = JSON.stringify({
      t: "presence",
      room: this.roomName(),
      count,
    });
    const messageBytes = message.length;

    const end = Math.min(sockets.length, this.presenceCursor + PRESENCE_FLUSH_BUDGET);
    for (let index = this.presenceCursor; index < end; index += 1) {
      const ws = sockets[index];
      if (!ws) continue;
      // Counted separately from event fan-out: this addresses the whole room, so
      // folding it into `deliverAttempts` would hide the cost of a publish.
      this.metrics.presenceDeliverAttempts += 1;
      try {
        ws.send(message);
        this.metrics.presencePayloadBytes += messageBytes;
      } catch {
        // A dead socket is evicted; the next flush publishes a fresh count.
        this.removeSocket(ws, "send-failed");
      }
    }
    this.metrics.presenceBroadcasts += 1;

    if (end < sockets.length) {
      // Budget spent: the rest of the room is owed this count.
      this.presenceCursor = end;
      this.metrics.presenceDeferredWindows += 1;
      this.markPresenceDirty();
      return;
    }

    this.presenceCursor = 0;
    if (this.presenceChangeSeq === this.presenceLapChanges && sockets.length === this.presenceLapSockets) {
      this.presenceStableCount = count;
    } else {
      this.markPresenceDirty();
    }
  }

  // ── Membership authorization (fail-closed) ──────────────────────────

  private async checkMembership(userId: string): Promise<boolean> {
    // FAIL CLOSED: without a membership API there is no way to authorize a
    // community room, so the connection is refused instead of granting access.
    // (Previously an unset API_URL returned `true`, silently disabling room
    // authorization for every authenticated member.)
    const config = resolveMembershipConfig(this.env);
    if (!config.configured || !config.apiUrl) {
      if (!warnedMissingMembershipApi) {
        warnedMissingMembershipApi = true;
        logEvent("error", {
          event: "realtime.membership.config_missing",
          room: this.roomName(),
        });
      }
      return false;
    }

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
        `${config.apiUrl}/api/communities/${communityId}/members/${userId}/check`,
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
    } catch (error) {
      // The API is unreachable: fail closed and make the cause observable.
      this.metrics.membershipChecksFailed += 1;
      logEvent("warn", {
        event: "realtime.membership.check_failed",
        community_id: communityId,
        error,
      });
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
