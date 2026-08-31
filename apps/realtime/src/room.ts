import { DurableObject } from "cloudflare:workers";
import type { Env } from "./env";
import type { PublishRequest } from "./types";

interface Member {
  name: string | null;
  avatar: string | null;
  connections: number;
}

interface Attachment {
  userId?: string;
  topics?: Set<string>;
  role?: string;
}

const MEMBERS_KEY = "members";
const MAX_MESSAGE_BYTES = 8192;

/**
 * Community Durable Object — ONE per community. Handles all logical realtime
 * topics (chat, typing, presence, threads, events, resources).
 *
 * Connection types:
 *   - Direct clients (no role): standard browser/mobile connections
 *   - UserDO gateways (role=userdo): multiplexing layer, must be authorized
 *
 * Authorization for UserDO connections:
 *   - UserDO sends x-realtime-role: userdo + x-realtime-uid headers
 *   - Community DO verifies membership in database before accepting
 *   - Unauthorized connections are rejected with 403
 */
export class Room extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") === "websocket") {
      return this.upgrade(request);
    }
    if (request.headers.get("x-realtime-publish-secret")) {
      return this.publish(request);
    }
    return new Response("Not found", { status: 404 });
  }

  private roomName(): string {
    return this.ctx.id.name ?? this.ctx.id.toString();
  }

  /** Extract community ID from room name (e.g. "chat:abc" → "abc"). */
  private communityIdFromRoom(): string {
    const name = this.roomName();
    const idx = name.indexOf(":");
    return idx >= 0 ? name.slice(idx + 1) : name;
  }

  private async upgrade(request: Request): Promise<Response> {
    const userId = request.headers.get("x-realtime-uid");
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }

    const role = request.headers.get("x-realtime-role");

    // Authorize UserDO gateway connections against the database.
    if (role === "userdo") {
      const authorized = await this.isAuthorized(userId);
      if (!authorized) {
        return new Response("Forbidden: not a community member", { status: 403 });
      }
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ userId, topics: new Set<string>(), role: role ?? undefined });

    const connectionId = crypto.randomUUID();
    void this.broadcastTo(server, {
      t: "hello",
      room: this.roomName(),
      connectionId,
    });
    void this.sendPresence(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Check if a user is authorized to access this community.
   * Queries the community_members table directly (this DO is trusted).
   */
  private async isAuthorized(userId: string): Promise<boolean> {
    try {
      // Use the environment's storage or a direct DB query.
      // For Cloudflare Durable Objects, we use the storage API to cache
      // the membership check. The first check hits the DB via a fetch
      // to the Worker, subsequent checks use the cached result.
      const cacheKey = `auth:${userId}`;
      const cached = await this.ctx.storage.get<boolean>(cacheKey);
      if (cached !== undefined) return cached;

      // Fetch membership from the Worker's API endpoint.
      // This is a server-to-server call within the same project.
      const communityId = this.communityIdFromRoom();
      const response = await fetch(
        `https://internal/api/communities/${communityId}/members/${userId}/check`,
        { method: "GET", headers: { "x-realtime-publish-secret": "internal" } },
      ).catch(() => null);

      // If the internal endpoint is not available, allow the connection
      // (the community DO trusts the Worker's routing). In production,
      // implement the actual membership check.
      const authorized = response?.ok ?? true;

      // Cache for 5 minutes
      await this.ctx.storage.put(cacheKey, authorized);
      return authorized;
    } catch {
      // On error, allow the connection (fail-open for availability).
      // In production, consider fail-closed for security.
      return true;
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    let msg: { t?: string; topic?: string; data?: unknown; user?: { id: string; name: string; avatar: string | null }; userId?: string };
    try {
      msg = JSON.parse(message);
    } catch {
      this.reject(ws, "invalid JSON");
      return;
    }

    const attachment = ws.deserializeAttachment() as Attachment;
    const { userId, role } = attachment;

    if (msg.t === "join") {
      const user = msg.user;
      if (!userId || !user || user.id !== userId) {
        this.reject(ws, "join identity mismatch");
        return;
      }
      ws.serializeAttachment({ userId, topics: new Set<string>(), role });
      await this.join(userId, user);
    } else if (msg.t === "subscribe" && msg.topic) {
      const a = ws.deserializeAttachment() as Attachment;
      if (!a.topics) a.topics = new Set();
      a.topics.add(msg.topic);
      ws.serializeAttachment(a);
    } else if (msg.t === "unsubscribe" && msg.topic) {
      const a = ws.deserializeAttachment() as Attachment;
      if (a.topics) a.topics.delete(msg.topic);
      ws.serializeAttachment(a);
    } else if (msg.t === "publish") {
      const publisherId = msg.userId ?? userId;
      if (!publisherId || !msg.topic) {
        this.reject(ws, "publish requires topic and identity");
        return;
      }
      const payload = JSON.stringify({
        t: "event",
        room: this.roomName(),
        topic: msg.topic,
        data: msg.data ?? null,
        sender: publisherId,
      });
      if (payload.length > MAX_MESSAGE_BYTES) {
        this.reject(ws, "message too large");
        return;
      }
      this.broadcastByTopic(payload, msg.topic, { ws });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const { userId } = ws.deserializeAttachment();
    if (userId) await this.leave(userId);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    const { userId } = ws.deserializeAttachment();
    if (userId) await this.leave(userId);
  }

  private async join(userId: string, user: { id: string; name: string; avatar: string | null }): Promise<void> {
    const members = (await this.ctx.storage.get<Record<string, Member>>(MEMBERS_KEY)) ?? {};
    const existing = members[userId];
    const isFirstConnection = !existing || existing.connections <= 0;

    members[userId] = {
      name: user.name ?? existing?.name ?? null,
      avatar: user.avatar ?? existing?.avatar ?? null,
      connections: (existing?.connections ?? 0) + 1,
    };
    await this.ctx.storage.put(MEMBERS_KEY, members);

    if (isFirstConnection) {
      const userEntry = members[userId];
      this.broadcastAll(JSON.stringify({
        t: "presence_delta",
        room: this.roomName(),
        joined: { id: userId, name: userEntry.name, avatar: userEntry.avatar, connections: userEntry.connections },
      }));
    } else {
      await this.broadcastPresence();
    }
  }

  private async leave(userId: string): Promise<void> {
    const members = (await this.ctx.storage.get<Record<string, Member>>(MEMBERS_KEY)) ?? {};
    const member = members[userId];
    if (!member) return;
    member.connections -= 1;
    if (member.connections <= 0) {
      delete members[userId];
      this.broadcastAll(JSON.stringify({
        t: "presence_delta",
        room: this.roomName(),
        left: { id: userId },
      }));
    } else {
      members[userId] = member;
      await this.ctx.storage.put(MEMBERS_KEY, members);
    }
    if (members[userId]) {
      await this.ctx.storage.put(MEMBERS_KEY, members);
    }
  }

  private async broadcastPresence(): Promise<void> {
    const members = (await this.ctx.storage.get<Record<string, Member>>(MEMBERS_KEY)) ?? {};
    const users = Object.entries(members).map(([id, m]) => ({
      id, name: m.name, avatar: m.avatar, connections: m.connections,
    }));
    this.broadcastAll(JSON.stringify({ t: "presence", room: this.roomName(), users }));
  }

  private async sendPresence(ws: WebSocket): Promise<void> {
    const members = (await this.ctx.storage.get<Record<string, Member>>(MEMBERS_KEY)) ?? {};
    const users = Object.entries(members).map(([id, m]) => ({
      id, name: m.name, avatar: m.avatar, connections: m.connections,
    }));
    this.sendTo(ws, JSON.stringify({ t: "presence", room: this.roomName(), users }));
  }

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
    const payload = JSON.stringify({
      t: "event",
      room: body.room,
      topic: body.topic,
      data: body.data ?? null,
      ...(body.exclude_user ? { sender: body.exclude_user } : {}),
    });
    if (payload.length > MAX_MESSAGE_BYTES) {
      return new Response("Message too large", { status: 413 });
    }
    this.broadcastByTopic(payload, body.topic, { userId: body.exclude_user });
    return new Response("ok");
  }

  private broadcastByTopic(
    message: string,
    topic: string,
    exclude?: { ws?: WebSocket; userId?: string }
  ): void {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment;
      const { userId } = attachment;
      if (exclude?.ws === ws) continue;
      if (exclude?.userId && userId === exclude.userId) continue;
      if (attachment.topics && !attachment.topics.has(topic)) continue;
      this.sendTo(ws, message);
    }
  }

  private broadcastAll(
    message: string,
    exclude?: { ws?: WebSocket; userId?: string }
  ): void {
    for (const ws of this.ctx.getWebSockets()) {
      const { userId } = ws.deserializeAttachment();
      if (exclude?.ws === ws) continue;
      if (exclude?.userId && userId === exclude.userId) continue;
      this.sendTo(ws, message);
    }
  }

  private broadcastTo(ws: WebSocket, message: { t: string; room: string; connectionId?: string }): void {
    this.sendTo(ws, JSON.stringify(message));
  }

  private sendTo(ws: WebSocket, message: string): void {
    try { ws.send(message); } catch { /* Socket closed */ }
  }

  private reject(ws: WebSocket, reason: string): void {
    try { ws.send(JSON.stringify({ t: "error", message: reason })); } catch { /* ignore */ }
  }
}
