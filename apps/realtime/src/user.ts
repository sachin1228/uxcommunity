import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

/**
 * Hibernation-safe state model:
 *
 * Survives DO hibernation/eviction:
 *   WS attachments (via serializeAttachment/deserializeAttachment):
 *     Client WS: { userId: string }
 *     Community WS: { communityId: string, topics: string[], gen: number }
 *   Persistent storage:
 *     community_subs:${userId}:${communityId}: { topics: string[], gen: number }
 *
 * Lost on hibernation (rebuilt on wake):
 *   this.clients Map → rebuilt from ctx.getWebSockets() client attachments
 *   this.communityConns Map → rebuilt from surviving community WS + storage
 *
 * Reconstruction (blockConcurrencyWhile):
 *   1. ctx.getWebSockets() → surviving sockets
 *   2. Client WS → rebuild clients Map from userId attachment
 *   3. Community WS → rebuild communityConns from communityId+topics attachment
 *   4. Storage → find missing community connections → reconnect with stored topics
 *
 * Race prevention:
 *   gen (generation) counter on subscriptions prevents stale unsubscribe from
 *   deleting a newer subscribe. Each subscribe increments gen; unsubscribe
 *   only deletes if gen matches.
 */

interface ClientState {
  userId: string;
  subscriptions: Map<string, SubscriptionEntry>;
}

interface SubscriptionEntry {
  topics: Set<string>;
  gen: number;
}

interface CommunityConn {
  ws: WebSocket;
  communityId: string;
  topics: Set<string>;
  ready: boolean;
  buffer: string[];
  retryCount: number;
  retryTimer: ReturnType<typeof setTimeout> | null;
}

const COMMUNITY_SUB_KEY_PREFIX = "community_subs:";
const MAX_RETRY_DELAY_MS = 60_000;
const BASE_RETRY_MS = 1_000;
const MAX_RETRIES = 10;

export class UserDO extends DurableObject<Env> {
  private clients = new Map<WebSocket, ClientState>();
  private communityConns = new Map<string, CommunityConn>();
  private reconstructed = false;

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
        | { userId?: string; communityId?: string; topics?: string[]; gen?: number }
        | undefined;

      if (!attachment) continue;

      if (attachment.userId && !attachment.communityId) {
        this.clients.set(ws, {
          userId: attachment.userId,
          subscriptions: new Map(),
        });
      } else if (attachment.communityId) {
        const topics = new Set(attachment.topics ?? []);
        this.communityConns.set(attachment.communityId, {
          ws,
          communityId: attachment.communityId,
          topics,
          ready: true,
          buffer: [],
          retryCount: 0,
          retryTimer: null,
        });
      }
    }

    // Rebuild subscription state from storage and reconnect missing community DOs.
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

          const entry: SubscriptionEntry = {
            topics: new Set(sub.topics),
            gen: sub.gen ?? 0,
          };
          state.subscriptions.set(communityId, entry);

          if (!this.communityConns.has(communityId)) {
            this.connectToCommunity(communityId, userId, entry.topics);
          } else {
            const conn = this.communityConns.get(communityId)!;
            for (const topic of sub.topics) {
              if (!conn.topics.has(topic)) {
                conn.topics.add(topic);
                this.sendToCommunity(conn, { t: "subscribe", topic });
              }
            }
          }
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

    for (const [room, entry] of state.subscriptions) {
      for (const topic of entry.topics) {
        this.sendToCommunityById(room, { t: "unsubscribe", topic });
      }
      await this.removeCommunitySub(state.userId, room);
      this.maybeDisconnectCommunity(room);
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
    const isNew = entry.topics.size === 0;
    entry.topics.add(topic);
    entry.gen++;

    // Persist with generation counter
    await this.ctx.storage.put(this.storageKey(state.userId, room), {
      topics: [...entry.topics],
      gen: entry.gen,
    });

    if (isNew) {
      this.connectToCommunity(room, state.userId, entry.topics);
    }
    this.sendToCommunityById(room, { t: "subscribe", topic });
  }

  private async handleUnsubscribe(
    state: ClientState,
    room: string,
    topic: string,
  ): Promise<void> {
    const entry = state.subscriptions.get(room);
    if (!entry) return;

    const currentGen = entry.gen;
    entry.topics.delete(topic);
    entry.gen++;

    if (entry.topics.size === 0) {
      state.subscriptions.delete(room);
      await this.removeCommunitySub(state.userId, room);
    } else {
      // Only write if gen hasn't advanced (no newer subscribe raced ahead)
      const stored = await this.ctx.storage.get<{ gen: number }>(this.storageKey(state.userId, room));
      if (!stored || stored.gen === currentGen) {
        await this.ctx.storage.put(this.storageKey(state.userId, room), {
          topics: [...entry.topics],
          gen: entry.gen,
        });
      }
    }

    this.sendToCommunityById(room, { t: "unsubscribe", topic });
    this.maybeDisconnectCommunity(room);
  }

  private async handlePublish(
    state: ClientState,
    room: string,
    topic: string,
    data: unknown,
  ): Promise<void> {
    const entry = state.subscriptions.get(room);
    if (!entry || !entry.topics.has(topic)) return;

    this.sendToCommunityById(room, {
      t: "publish",
      topic,
      data,
      userId: state.userId,
    });
  }

  // ── Community DO connections (with bounded exponential retry) ─────────

  private connectToCommunity(
    room: string,
    userId: string,
    topics: Set<string>,
  ): void {
    if (this.communityConns.has(room)) return;

    const id = this.env.COMMUNITY_DO.idFromName(room);
    const stub = this.env.COMMUNITY_DO.get(id);

    const upgraded = new Request(
      `https://dummy/ws?room=${encodeURIComponent(room)}`,
      {
        headers: new Headers([
          ["Upgrade", "websocket"],
          ["x-realtime-uid", userId],
          ["x-realtime-role", "userdo"],
        ]),
      },
    );

    const conn: CommunityConn = {
      ws: null as unknown as WebSocket,
      communityId: room,
      topics: new Set(topics),
      ready: false,
      buffer: [],
      retryCount: 0,
      retryTimer: null,
    };
    this.communityConns.set(room, conn);

    stub.fetch(upgraded).then((response) => {
      const ws = (response as unknown as { webSocket?: WebSocket }).webSocket;
      if (!ws) {
        this.retryCommunityConnect(room, userId, topics);
        return;
      }

      this.ctx.acceptWebSocket(ws);

      ws.serializeAttachment({
        communityId: room,
        topics: [...topics],
      });

      conn.ws = ws;
      conn.ready = true;
      conn.retryCount = 0;

      ws.addEventListener("message", (event: MessageEvent) => {
        this.onCommunityMessage(room, String(event.data));
      });

      ws.addEventListener("close", () => {
        this.onCommunityDisconnect(room);
      });

      ws.addEventListener("error", () => {
        this.onCommunityDisconnect(room);
      });

      // Flush buffered messages
      for (const buffered of conn.buffer) {
        try { ws.send(buffered); } catch { /* ignore */ }
      }
      conn.buffer = [];
    }).catch(() => {
      this.retryCommunityConnect(room, userId, topics);
    });
  }

  private retryCommunityConnect(
    room: string,
    userId: string,
    topics: Set<string>,
  ): void {
    const conn = this.communityConns.get(room);
    if (!conn) return;

    // Check if any client still needs this community
    let stillNeeded = false;
    for (const [, state] of this.clients) {
      if (state.subscriptions.has(room) && state.subscriptions.get(room)!.topics.size > 0) {
        stillNeeded = true;
        break;
      }
    }
    if (!stillNeeded) {
      this.communityConns.delete(room);
      return;
    }

    if (conn.retryCount >= MAX_RETRIES) {
      // Give up after max retries
      this.communityConns.delete(room);
      return;
    }

    const delay = Math.min(
      BASE_RETRY_MS * 2 ** conn.retryCount,
      MAX_RETRY_DELAY_MS,
    );
    conn.retryCount++;

    conn.retryTimer = setTimeout(() => {
      conn.retryTimer = null;
      this.communityConns.delete(room);
      this.connectToCommunity(room, userId, topics);
    }, delay);
  }

  private onCommunityDisconnect(room: string): void {
    const conn = this.communityConns.get(room);
    if (!conn) return;

    // Cancel any pending retry
    if (conn.retryTimer) {
      clearTimeout(conn.retryTimer);
      conn.retryTimer = null;
    }

    this.communityConns.delete(room);

    // Reconnect if any client still needs this community
    for (const [, state] of this.clients) {
      const entry = state.subscriptions.get(room);
      if (entry && entry.topics.size > 0) {
        this.connectToCommunity(room, state.userId, entry.topics);
        break;
      }
    }
  }

  private async onCommunityMessage(room: string, raw: string): Promise<void> {
    let msg: {
      t?: string;
      room?: string;
      topic?: string;
      data?: unknown;
      sender?: string;
      users?: unknown[];
      joined?: unknown;
      left?: unknown;
      message?: string;
    };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    for (const [ws, state] of this.clients) {
      const entry = state.subscriptions.get(room);
      if (!entry || entry.topics.size === 0) continue;

      if (msg.t === "event" && msg.topic) {
        if (!entry.topics.has(msg.topic)) continue;
        if (msg.sender === state.userId) continue;
        this.sendToClient(ws, {
          t: "event",
          room,
          topic: msg.topic,
          data: msg.data,
          sender: msg.sender,
        });
      } else if (msg.t === "presence" || msg.t === "presence_delta") {
        this.sendToClient(ws, { ...msg, room });
      } else if (msg.t === "error") {
        this.sendToClient(ws, msg);
      }
    }
  }

  private maybeDisconnectCommunity(room: string): void {
    const conn = this.communityConns.get(room);
    if (!conn) return;

    let anyClientSubscribed = false;
    for (const [, state] of this.clients) {
      const entry = state.subscriptions.get(room);
      if (entry && entry.topics.size > 0) {
        anyClientSubscribed = true;
        break;
      }
    }
    if (!anyClientSubscribed) {
      if (conn.retryTimer) clearTimeout(conn.retryTimer);
      try { conn.ws?.close(); } catch { /* ignore */ }
      this.communityConns.delete(room);
    }
  }

  private sendToCommunityById(room: string, msg: unknown): void {
    const conn = this.communityConns.get(room);
    if (!conn) return;
    this.sendToCommunity(conn, msg);
  }

  private sendToCommunity(conn: CommunityConn, msg: unknown): void {
    const json = JSON.stringify(msg);
    if (conn.ready && conn.ws?.readyState === WebSocket.OPEN) {
      try { conn.ws.send(json); } catch { /* ignore */ }
    } else {
      conn.buffer.push(json);
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
