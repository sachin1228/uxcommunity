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
}

const MEMBERS_KEY = "members";
const MAX_MESSAGE_BYTES = 8192;

/**
 * One room = one Durable Object. Holds all WebSockets subscribed to that room,
 * tracks presence (who is connected), and rebroadcasts both server-published
 * events (via POST /publish) and low-trust client publishes (typing, etc.).
 *
 * Uses the WebSocket Hibernation API: `acceptWebSocket` lets the runtime evict
 * this object between messages without dropping connections. Identity and
 * presence live in storage so they survive eviction.
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

  /** WebSocket upgrade. The Worker has already verified the session JWT. */
  private roomName(): string {
    return this.ctx.id.name ?? this.ctx.id.toString();
  }

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

    const connectionId = crypto.randomUUID();
    void this.broadcastTo(server, {
      t: "hello",
      room: this.roomName(),
      connectionId,
    });
    void this.sendPresence(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    let msg: { t?: string; topic?: string; data?: unknown; user?: { id: string; name: string; avatar: string | null } };
    try {
      msg = JSON.parse(message);
    } catch {
      this.reject(ws, "invalid JSON");
      return;
    }

    const { userId } = ws.deserializeAttachment();

    if (msg.t === "join") {
      const user = msg.user;
      if (!userId || !user || user.id !== userId) {
        this.reject(ws, "join identity mismatch");
        return;
      }
      ws.serializeAttachment({ userId });
      await this.join(userId, user);
    } else if (msg.t === "publish") {
      if (!userId || !msg.topic) {
        this.reject(ws, "publish requires topic and identity");
        return;
      }
      const payload = JSON.stringify({
        t: "event",
        room: this.roomName(),
        topic: msg.topic,
        data: msg.data ?? null,
        sender: userId,
      });
      if (payload.length > MAX_MESSAGE_BYTES) {
        this.reject(ws, "message too large");
        return;
      }
      // Exclude only the sending socket, so the same user's other tabs still
      // receive the event (needed for presence/voice rooms and multi-tab sync).
      this.broadcast(payload, { ws });
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
    members[userId] = {
      name: user.name ?? existing?.name ?? null,
      avatar: user.avatar ?? existing?.avatar ?? null,
      connections: (existing?.connections ?? 0) + 1,
    };
    await this.ctx.storage.put(MEMBERS_KEY, members);
    await this.broadcastPresence();
  }

  private async leave(userId: string): Promise<void> {
    const members = (await this.ctx.storage.get<Record<string, Member>>(MEMBERS_KEY)) ?? {};
    const member = members[userId];
    if (!member) return;
    member.connections -= 1;
    if (member.connections <= 0) {
      delete members[userId];
    } else {
      members[userId] = member;
    }
    await this.ctx.storage.put(MEMBERS_KEY, members);
    await this.broadcastPresence();
  }

  private async broadcastPresence(): Promise<void> {
    const members = (await this.ctx.storage.get<Record<string, Member>>(MEMBERS_KEY)) ?? {};
    const users = Object.entries(members).map(([id, m]) => ({
      id,
      name: m.name,
      avatar: m.avatar,
      connections: m.connections,
    }));
    this.broadcast(JSON.stringify({ t: "presence", room: this.roomName(), users }));
  }

  private async sendPresence(ws: WebSocket): Promise<void> {
    const members = (await this.ctx.storage.get<Record<string, Member>>(MEMBERS_KEY)) ?? {};
    const users = Object.entries(members).map(([id, m]) => ({
      id,
      name: m.name,
      avatar: m.avatar,
      connections: m.connections,
    }));
    this.sendTo(ws, JSON.stringify({ t: "presence", room: this.roomName(), users }));
  }

  /** Server-to-server publish from the Worker (already secret-authenticated). */
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
    // Server-side publishes keep excluding by userId (the sender already has
    // the row from the API response).
    this.broadcast(payload, { userId: body.exclude_user });
    return new Response("ok");
  }

  private broadcast(
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
    try {
      ws.send(message);
    } catch {
      // Socket already closed; leave() cleans presence on close.
    }
  }

  private reject(ws: WebSocket, reason: string): void {
    try {
      ws.send(JSON.stringify({ t: "error", message: reason }));
    } catch {
      // ignore
    }
  }
}