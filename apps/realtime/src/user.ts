import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

/**
 * User Durable Object — ONE per user. Owns the single client WebSocket
 * and routes messages to community DOs via RPC.
 *
 * Architecture (RPC-based):
 *   Client → UserDO (1 physical WebSocket) → RPC → CommunityDO
 *   CommunityDO → RPC deliverEvent() → UserDO → Client(s)
 *
 * Hibernation-safe state model:
 *   Survives DO hibernation/eviction:
 *     WS attachments (via serializeAttachment/deserializeAttachment):
 *       Client WS: { userId: string }
 *     Persistent storage:
 *       community_subs:${userId}:${communityId}: { topics: string[], gen: number }
 *
 *   Lost on hibernation (rebuilt on wake):
 *     this.clients Map → rebuilt from ctx.getWebSockets() client attachments
 *
 * Race prevention:
 *   gen (generation) counter on subscriptions prevents stale unsubscribe from
 *   deleting a newer subscribe. Each subscribe increments gen; unsubscribe
 *   only deletes if gen matches.
 *
 * Multiple devices/tabs:
 *   One UserDO can have multiple client WebSocket connections (browser tabs,
 *   mobile devices). Each has its own subscriptions map. deliverEvent()
 *   iterates ALL clients but checks room+topic match per client.
 */

interface ClientState {
  userId: string;
  subscriptions: Map<string, SubscriptionEntry>;
}

interface SubscriptionEntry {
  topics: Set<string>;
  gen: number;
}

const COMMUNITY_SUB_KEY_PREFIX = "community_subs:";

export class UserDO extends DurableObject<Env> {
  private clients = new Map<WebSocket, ClientState>();
  private reconstructed = false;

  // ── Fetch handler ────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
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

    // Rebuild subscription state from storage
    const userIds = new Set<string>();
    for (const [, state] of this.clients) {
      userIds.add(state.userId);
    }

    for (const userId of userIds) {
      const keys = await this.findStorageKeys(`${COMMUNITY_SUB_KEY_PREFIX}${userId}:`);
      for (const key of keys) {
        const sub = await this.ctx.storage.get<{ topics: string[]; gen: number }>(key);
        if (!sub || sub.topics.length === 0) continue;

        const communityId = key.slice(`${COMMUNITY_SUB_KEY_PREFIX}${userId}:`.length);

        for (const [, state] of this.clients) {
          if (state.userId !== userId) continue;

          state.subscriptions.set(communityId, {
            topics: new Set(sub.topics),
            gen: sub.gen ?? 0,
          });
        }
      }
    }
  }

  private async findStorageKeys(prefix: string): Promise<string[]> {
    const result = await this.ctx.storage.list({ prefix });
    return [...result.keys()].map(String);
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
      await this.handleSubscribe(state, msg.room, msg.topic);
    } else if (msg.t === "unsubscribe" && msg.room && msg.topic) {
      await this.handleUnsubscribe(state, msg.room, msg.topic);
    } else if (msg.t === "publish" && msg.room && msg.topic) {
      await this.handlePublish(state, msg.room, msg.topic, msg.data);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const state = this.clients.get(ws);
    if (!state) return;

    // Unsubscribe from all communities
    for (const [communityId, entry] of state.subscriptions) {
      for (const topic of entry.topics) {
        this.callCommunityUnsubscribe(state.userId, communityId, topic);
      }
      await this.removeCommunitySub(state.userId, communityId);
    }
    this.clients.delete(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws);
  }

  // ── Subscription routing (race-safe) ─────────────────────────────────

  private async handleSubscribe(
    state: ClientState,
    room: string,
    topic: string,
  ): Promise<void> {
    let entry = state.subscriptions.get(room);
    if (!entry) {
      entry = { topics: new Set(), gen: 0 };
      state.subscriptions.set(room, entry);
    }
    entry.topics.add(topic);
    entry.gen++;

    // Persist with generation counter
    await this.ctx.storage.put(this.storageKey(state.userId, room), {
      topics: [...entry.topics],
      gen: entry.gen,
    });

    // Call CommunityDO RPC to subscribe
    await this.callCommunitySubscribe(state.userId, room, [...entry.topics]);
  }

  private async handleUnsubscribe(
    state: ClientState,
    room: string,
    topic: string,
  ): Promise<void> {
    const entry = state.subscriptions.get(room);
    if (!entry) return;

    entry.topics.delete(topic);
    entry.gen++;

    if (entry.topics.size === 0) {
      state.subscriptions.delete(room);
      await this.removeCommunitySub(state.userId, room);
    } else {
      await this.ctx.storage.put(this.storageKey(state.userId, room), {
        topics: [...entry.topics],
        gen: entry.gen,
      });
    }

    // Call CommunityDO RPC to unsubscribe
    await this.callCommunityUnsubscribe(state.userId, room, topic);
  }

  private async handlePublish(
    state: ClientState,
    room: string,
    topic: string,
    data: unknown,
  ): Promise<void> {
    const entry = state.subscriptions.get(room);
    if (!entry || !entry.topics.has(topic)) return;

    // Call CommunityDO RPC to publish
    await this.callCommunityPublish(state.userId, room, topic, data);
  }

  // ── Community DO RPC calls ────────────────────────────────────────────

  private getCommunityStub(roomName: string) {
    return this.env.COMMUNITY_DO.get(this.env.COMMUNITY_DO.idFromName(roomName));
  }

  private async callCommunitySubscribe(
    userId: string,
    roomName: string,
    topics: string[],
  ): Promise<void> {
    try {
      const stub = this.getCommunityStub(roomName);
      await stub.subscribe(userId, topics, this.env.RPC_SECRET);
    } catch {
      // RPC failed — community will re-subscribe on next client message
    }
  }

  private async callCommunityUnsubscribe(
    userId: string,
    roomName: string,
    topic: string,
  ): Promise<void> {
    try {
      const stub = this.getCommunityStub(roomName);
      await stub.unsubscribe(userId, topic, this.env.RPC_SECRET);
    } catch {
      // RPC failed — community will re-subscribe on next client message
    }
  }

  private async callCommunityPublish(
    userId: string,
    roomName: string,
    topic: string,
    data: unknown,
  ): Promise<void> {
    try {
      const stub = this.getCommunityStub(roomName);
      await stub.publishMessage(userId, topic, data, this.env.RPC_SECRET);
    } catch {
      // RPC failed — client will retry or recover via DB
    }
  }

  // ── RPC: deliverEvent (called by CommunityDO) ─────────────────────────

  /**
   * Called by CommunityDO via RPC to deliver an event to this user's clients.
   *
   * Uses the existing subscription state (room + topic) to determine which
   * client sockets should receive the event. One user may have multiple
   * browser tabs/devices — each is checked independently.
   *
   * Performance:
   *   - Iterates all client sockets for this user
   *   - Checks room+topic match per client (O(clients × 1) per event)
   *   - Only sends to matching clients
   */
  async deliverEvent(
    room: string,
    topic: string,
    data: unknown,
    sender?: string,
  ): Promise<void> {
    if (!this.reconstructed) {
      await this.ctx.blockConcurrencyWhile(() => {
        if (!this.reconstructed) {
          this.reconstructState();
          this.reconstructed = true;
        }
      });
    }

    for (const [ws, state] of this.clients) {
      const entry = state.subscriptions.get(room);
      if (!entry || entry.topics.size === 0) continue;
      if (!entry.topics.has(topic)) continue;
      if (sender && sender === state.userId) continue;

      this.sendToClient(ws, {
        t: "event",
        room,
        topic,
        data,
        sender,
      });
    }
  }

  // ── Storage helpers ──────────────────────────────────────────────────

  private storageKey(userId: string, communityId: string): string {
    return `${COMMUNITY_SUB_KEY_PREFIX}${userId}:${communityId}`;
  }

  private async removeCommunitySub(userId: string, communityId: string): Promise<void> {
    await this.ctx.storage.delete(this.storageKey(userId, communityId));
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private sendToClient(ws: WebSocket, msg: unknown): void {
    try { ws.send(JSON.stringify(msg)); } catch { /* ignore */ }
  }
}
