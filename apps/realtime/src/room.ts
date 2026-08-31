import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { PublishRequest } from "./types";

/**
 * Community Durable Object — ONE per community. Handles all logical realtime
 * topics (chat, typing, presence, threads, events, resources).
 *
 * Architecture (RPC-based):
 *   Client → UserDO → RPC subscribe/unsubscribe/publish → CommunityDO
 *   CommunityDO → RPC deliverEvent() → UserDO → Client(s)
 *
 * Dual-index subscriber store:
 *   subscriptionsByUser:  userId → Set<topic>
 *   subscriptionsByTopic: topic → Set<userId>
 *
 * Both indices are kept in-memory for O(topic) broadcast lookup.
 * Persisted to SQLite for hibernation survival.
 *
 * Storage key format: sub:${userId}:${topic}
 *   - One entry per user-topic pair
 *   - Enables efficient listing for unsubscribe and hibernation rebuild
 *
 * Authorization:
 *   - RPC methods verify caller via RPC_SECRET (defense-in-depth)
 *   - Membership checked via internal API (fail-closed)
 *
 * Event classification:
 *   - EPHEMERAL (typing, presence): drop on RPC failure, no retry
 *   - DURABLE (chat, edit, delete, reaction): 1 retry, client recovers via DB
 */

interface Member {
  name: string | null;
  avatar: string | null;
  connections: number;
}

const MEMBERS_KEY = "members";
const MAX_MESSAGE_BYTES = 8192;
const SUB_KEY_PREFIX = "sub:";

/** Events that are ephemeral — no retry on RPC failure. */
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

  // ── Fetch handler (HTTP only — no WebSocket upgrades) ────────────────

  async fetch(request: Request): Promise<Response> {
    // Server-side publish via HTTP POST
    if (request.headers.get("x-realtime-publish-secret")) {
      return this.publish(request);
    }
    return new Response("Not found", { status: 404 });
  }

  // ── Subscriber index reconstruction after hibernation ────────────────

  private async ensureSubscribers(): Promise<void> {
    if (this.subscribersReconstructed) return;
    await this.ctx.blockConcurrencyWhile(async () => {
      if (this.subscribersReconstructed) return;
      await this.reconstructSubscribers();
      this.subscribersReconstructed = true;
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

  // ── RPC: subscribe ───────────────────────────────────────────────────

  /**
   * Called by UserDO via RPC when a user subscribes to a topic.
   *
   * Authorization: caller must provide matching RPC_SECRET.
   * Membership: checked via internal API (fail-closed).
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
      const key = `${SUB_KEY_PREFIX}${userId}:${topic}`;
      await this.ctx.storage.put(key, { userId, topic });
    }

    return { ok: true };
  }

  // ── RPC: unsubscribe ─────────────────────────────────────────────────

  /**
   * Called by UserDO via RPC when a user unsubscribes from a topic.
   */
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
      // Update dual index
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

      // Remove from SQLite
      const key = `${SUB_KEY_PREFIX}${userId}:${topic}`;
      await this.ctx.storage.delete(key);
    }

    return { ok: true };
  }

  // ── RPC: publish (from UserDO client message) ────────────────────────

  /**
   * Called by UserDO via RPC when a user publishes a message.
   */
  async publishMessage(
    userId: string,
    topic: string,
    data: unknown,
    rpcSecret?: string,
  ): Promise<void> {
    if (rpcSecret !== this.env.RPC_SECRET) return;

    await this.ensureSubscribers();
    await this.broadcastByTopic(topic, data, userId);
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
   * Performance:
   *   - Subscriber lookup: O(1) via subscriptionsByTopic.get(topic)
   *   - Delivery: O(number of subscribers for that topic)
   *
   * For 500 active chat subscribers:
   *   1 topic lookup + ~500 RPC deliveries (concurrent)
   *
   * Event classification:
   *   - EPHEMERAL (typing, presence): no retry on RPC failure
   *   - DURABLE (chat, edit, delete, reaction): 1 retry with 100ms backoff
   */
  private async broadcastByTopic(
    topic: string,
    data: unknown,
    excludeUserId?: string,
  ): Promise<void> {
    const topicSubs = this.subscriptionsByTopic.get(topic);
    if (!topicSubs || topicSubs.size === 0) return;

    const isEphemeral = EPHEMERAL_TOPICS.has(topic);
    const roomName = this.roomName();

    const calls: Promise<void>[] = [];
    for (const userId of topicSubs) {
      if (excludeUserId && userId === excludeUserId) continue;

      const call = this.deliverToUser(roomName, topic, data, userId, isEphemeral);
      calls.push(call);
    }

    await Promise.allSettled(calls);
  }

  /**
   * Deliver an event to a specific user via UserDO RPC.
   * Ephemeral events: no retry.
   * Durable events: 1 retry with 100ms backoff.
   */
  private async deliverToUser(
    room: string,
    topic: string,
    data: unknown,
    userId: string,
    isEphemeral: boolean,
  ): Promise<void> {
    const stub = this.env.USER_DO.get(this.env.USER_DO.idFromName(`user:${userId}`));

    try {
      await stub.deliverEvent(room, topic, data, undefined);
    } catch (err) {
      if (isEphemeral) {
        // Ephemeral: drop silently
        return;
      }
      // Durable: 1 retry with 100ms backoff
      await new Promise((r) => setTimeout(r, 100));
      try {
        await stub.deliverEvent(room, topic, data, undefined);
      } catch {
        // Second failure: drop. Client recovers via DB/history sync.
      }
    }
  }

  // ── Membership authorization (fail-closed) ──────────────────────────

  /** Cache TTL: re-check membership every 60 seconds. */
  private static readonly MEMBERSHIP_CACHE_TTL_MS = 60_000;
  private membershipCache = new Map<string, { ok: boolean; ts: number }>();

  /**
   * Verify the user is a member of this community via the internal API.
   *
   * Fail-closed: any error (network, timeout, malformed, non-200) → reject.
   *
   * If API_URL is not configured, the Worker-level JWT auth is the only
   * gate. Set API_URL + API_SECRET in production to enable community-level
   * membership checks.
   */
  private async checkMembership(userId: string): Promise<boolean> {
    if (!this.env.API_URL) return true;

    const communityId = this.communityIdFromRoom();
    const cacheKey = `${communityId}:${userId}`;

    // Check in-memory cache first (avoids repeated storage reads)
    const cached = this.membershipCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < Room.MEMBERSHIP_CACHE_TTL_MS) {
      return cached.ok;
    }

    // Check internal API (fail-closed)
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

      // Parse JSON response — treat any non-200 as rejection
      let authorized = false;
      if (response.ok) {
        try {
          const body = await response.json() as { ok?: boolean };
          authorized = body.ok === true;
        } catch {
          // Malformed JSON → reject
          authorized = false;
        }
      }

      // Update in-memory cache
      this.membershipCache.set(cacheKey, { ok: authorized, ts: Date.now() });

      // Also persist to storage for hibernation survival
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
      // Network error, timeout, or abort → reject (fail-closed)
      // Clear stale cache on failure so next attempt re-checks
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
}
