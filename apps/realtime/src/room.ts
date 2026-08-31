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
  /** Logical topics this socket has subscribed to (e.g. "chat", "typing", "threads"). */
  topics?: Set<string>;
  /** Set to "userdo" for UserDO gateway connections so events include room name. */
  role?: string;
}

const MEMBERS_KEY = "members";
const MAX_MESSAGE_BYTES = 8192;

/**
 * Community Durable Object — ONE per community. Handles all logical realtime
 * topics (chat, typing, presence, threads, events, resources) for that community.
 *
 * Each client connects once via a single WebSocket and subscribes to the
 * logical topics it needs. Events are filtered per-socket by topic.
 *
 * Supports two connection types:
 *   - Direct clients (role=undefined): receive events as before
 *   - UserDO gateways (role=userdo): receive events with room name included,
 *     then forward to their own connected clients
 *
 * Topic subscription model:
 *   - Client sends `{ t: "subscribe", topic: "chat" }` to receive chat events.
 *   - Client sends `{ t: "unsubscribe", topic: "typing" }` to stop typing events.
 *   - Presence (snapshots + deltas) is always sent to all sockets regardless
 *     of topic subscriptions (presence reflects who is in the room).
 *   - Server-side publishes (via POST /publish) also respect topic subscriptions.
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

  private async upgrade(request: Request): Promise<Response> {
    const userId = request.headers.get("x-realtime-uid");
    if (!userId) {
      return new Response("Unauthorized", { status: 401 });
    }
    const role = request.headers.get("x-realtime-role") ?? undefined;

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    // Start with no topic subscriptions — client must subscribe explicitly.
    server.serializeAttachment({ userId, topics: new Set<string>(), role });

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
      id,
      name: m.name,
      avatar: m.avatar,
      connections: m.connections,
    }));
    this.broadcastAll(JSON.stringify({ t: "presence", room: this.roomName(), users }));
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
    this.broadcastByTopic(payload, body.topic, { userId: body.exclude_user });
    return new Response("ok");
  }

  /**
   * Broadcast a message to all sockets subscribed to the given topic.
   * Excludes a specific socket or user if specified.
   */
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

  /**
   * Broadcast a message to ALL connected sockets (no topic filtering).
   * Used for presence snapshots and deltas which are room-wide.
   */
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
