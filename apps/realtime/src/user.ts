import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";

/**
 * What survives DO hibernation/eviction:
 *
 * 1. WebSocket attachments (via ws.serializeAttachment / deserializeAttachment)
 *    - Client WS attachment: { userId: string }
 *    - Community WS attachment: { communityId: string, topics: string[] }
 *
 * 2. Persistent storage (this.ctx.storage)
 *    - key `community_subs:${userId}:${communityId}` → { topics: string[] }
 *    - Used to reconnect community DOs after hibernation
 *
 * What is LOST on hibernation:
 * - this.clients Map (rebuilt from surviving WS attachments via ctx.getWebSockets())
 * - this.communityConns Map (rebuilt from surviving community WS attachments + storage)
 *
 * Reconstruction flow on wake:
 *   1. ctx.getWebSockets() → surviving client + community sockets
 *   2. For each client WS: deserialize userId from attachment
 *   3. For each community WS: deserialize communityId + topics from attachment
 *   4. Read storage for community_subs to find what needs reconnecting
 *   5. Reconnect missing community DO connections
 *   6. Resubscribe topics on reconnected connections
 */

interface ClientState {
  userId: string;
  /** room → set of subscribed topics (rebuilt from community WS topics on wake) */
  subscriptions: Map<string, Set<string>>;
}

interface CommunityConn {
  ws: WebSocket;
  communityId: string;
  topics: Set<string>;
  ready: boolean;
  buffer: string[];
}

const COMMUNITY_SUB_KEY_PREFIX = "community_subs:";

export class UserDO extends DurableObject<Env> {
  private clients = new Map<WebSocket, ClientState>();
  private communityConns = new Map<string, CommunityConn>();
  private reconstructed = false;

  async fetch(request: Request): Promise<Response> {
    // On first fetch after hibernation, reconstruct state from surviving sockets.
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
    // 1. Rebuild client map from surviving client WS attachments.
    const userCommunities = new Map<string, Set<string>>();

    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as
        | { userId?: string; communityId?: string; topics?: string[] }
        | undefined;

      if (!attachment) continue;

      if (attachment.userId && !attachment.communityId) {
        // Client WebSocket
        this.clients.set(ws, {
          userId: attachment.userId,
          subscriptions: new Map(),
        });
      } else if (attachment.communityId) {
        // Community DO WebSocket (survived hibernation)
        const topics = new Set(attachment.topics ?? []);
        this.communityConns.set(attachment.communityId, {
          ws,
          communityId: attachment.communityId,
          topics,
          ready: true,
          buffer: [],
        });
        // We'll figure out which clients subscribe to this community below
      }
    }

    // 2. Read persistent storage to find all community subscriptions.
    const userIds = new Set<string>();
    for (const [, state] of this.clients) {
      userIds.add(state.userId);
    }

    for (const userId of userIds) {
      const keys = await this.findStorageKeys(`${COMMUNITY_SUB_KEY_PREFIX}${userId}:`);
      for (const key of keys) {
        const sub = await this.ctx.storage.get<{ topics: string[] }>(key);
        if (!sub || sub.topics.length === 0) continue;

        const communityId = key.slice(`${COMMUNITY_SUB_KEY_PREFIX}${userId}:`.length);

        // Rebuild client subscription map
        for (const [, state] of this.clients) {
          if (state.userId !== userId) continue;
          state.subscriptions.set(communityId, new Set(sub.topics));

          // Ensure community connection exists
          if (!this.communityConns.has(communityId)) {
            this.connectToCommunity(communityId, userId, new Set(sub.topics));
          } else {
            // Resubscribe topics on existing connection
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

    // Attachment survives hibernation — only store the userId.
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
      this.sendToClient(ws, {
        t: "hello",
        connectionId: crypto.randomUUID(),
      });
    } else if (msg.t === "subscribe" && msg.room && msg.topic) {
      await this.handleSubscribe(ws, state, msg.room, msg.topic);
    } else if (msg.t === "unsubscribe" && msg.room && msg.topic) {
      await this.handleUnsubscribe(state, msg.room, msg.topic);
    } else if (msg.t === "publish" && msg.room && msg.topic) {
      await this.handlePublish(state, msg.room, msg.topic, msg.data);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const state = this.clients.get(ws);
    if (!state) return;

    // Remove client and clean up storage
    for (const [room, topics] of state.subscriptions) {
      for (const topic of topics) {
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

  // ── Subscription routing ─────────────────────────────────────────────

  private async handleSubscribe(
    ws: WebSocket,
    state: ClientState,
    room: string,
    topic: string,
  ): Promise<void> {
    let topics = state.subscriptions.get(room);
    if (!topics) {
      topics = new Set();
      state.subscriptions.set(room, topics);
    }
    const isNew = topics.size === 0;
    topics.add(topic);

    // Persist to storage (survives hibernation)
    await this.addCommunitySub(state.userId, room, topic);

    if (isNew) {
      this.connectToCommunity(room, state.userId, topics);
    }
    this.sendToCommunityById(room, { t: "subscribe", topic });
  }

  private async handleUnsubscribe(
    state: ClientState,
    room: string,
    topic: string,
  ): Promise<void> {
    const topics = state.subscriptions.get(room);
    if (!topics) return;
    topics.delete(topic);

    // Update storage
    if (topics.size === 0) {
      state.subscriptions.delete(room);
      await this.removeCommunitySub(state.userId, room);
    } else {
      await this.setCommunityTopics(state.userId, room, topics);
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
    const topics = state.subscriptions.get(room);
    if (!topics || !topics.has(topic)) return;

    this.sendToCommunityById(room, {
      t: "publish",
      topic,
      data,
      userId: state.userId,
    });
  }

  // ── Community DO connections (hibernation-safe) ──────────────────────

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

    stub.fetch(upgraded).then((response) => {
      const ws = (response as unknown as { webSocket?: WebSocket }).webSocket;
      if (!ws) return;

      // acceptWebSocket ensures this socket survives future hibernations.
      this.ctx.acceptWebSocket(ws);

      // Attachment survives hibernation — store communityId and topics.
      ws.serializeAttachment({
        communityId: room,
        topics: [...topics],
      });

      const conn: CommunityConn = {
        ws,
        communityId: room,
        topics: new Set(topics),
        ready: true,
        buffer: [],
      };
      this.communityConns.set(room, conn);

      ws.addEventListener("message", (event: MessageEvent) => {
        this.onCommunityMessage(room, String(event.data));
      });

      ws.addEventListener("close", () => {
        this.onCommunityDisconnect(room);
      });

      ws.addEventListener("error", () => {
        this.onCommunityDisconnect(room);
      });

      // Flush any buffered messages
      for (const buffered of conn.buffer) {
        try { ws.send(buffered); } catch { /* ignore */ }
      }
      conn.buffer = [];
    }).catch(() => {
      // Connection failed; will retry on next publish
    });
  }

  private onCommunityDisconnect(room: string): void {
    this.communityConns.delete(room);

    // Reconnect if any client still needs this community
    for (const [, state] of this.clients) {
      if (state.subscriptions.has(room) && state.subscriptions.get(room)!.size > 0) {
        this.connectToCommunity(room, state.userId, state.subscriptions.get(room)!);
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
      const topics = state.subscriptions.get(room);
      if (!topics || topics.size === 0) continue;

      if (msg.t === "event" && msg.topic) {
        if (!topics.has(msg.topic)) continue;
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
      if (state.subscriptions.has(room) && state.subscriptions.get(room)!.size > 0) {
        anyClientSubscribed = true;
        break;
      }
    }
    if (!anyClientSubscribed) {
      try { conn.ws.close(); } catch { /* ignore */ }
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
    if (conn.ready && conn.ws.readyState === WebSocket.OPEN) {
      try { conn.ws.send(json); } catch { /* ignore */ }
    } else {
      conn.buffer.push(json);
    }
  }

  // ── Persistent storage helpers ───────────────────────────────────────

  private storageKey(userId: string, communityId: string): string {
    return `${COMMUNITY_SUB_KEY_PREFIX}${userId}:${communityId}`;
  }

  private async addCommunitySub(
    userId: string,
    communityId: string,
    topic: string,
  ): Promise<void> {
    const key = this.storageKey(userId, communityId);
    const existing = await this.ctx.storage.get<{ topics: string[] }>(key);
    const topics = existing?.topics ?? [];
    if (!topics.includes(topic)) {
      topics.push(topic);
      await this.ctx.storage.put(key, { topics });
    }
  }

  private async removeCommunitySub(
    userId: string,
    communityId: string,
  ): Promise<void> {
    const key = this.storageKey(userId, communityId);
    await this.ctx.storage.delete(key);
  }

  private async setCommunityTopics(
    userId: string,
    communityId: string,
    topics: Set<string>,
  ): Promise<void> {
    const key = this.storageKey(userId, communityId);
    if (topics.size === 0) {
      await this.ctx.storage.delete(key);
    } else {
      await this.ctx.storage.put(key, { topics: [...topics] });
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private sendToClient(ws: WebSocket, msg: unknown): void {
    try {
      ws.send(JSON.stringify(msg));
    } catch { /* ignore */ }
  }
}
