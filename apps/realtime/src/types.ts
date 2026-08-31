/**
 * Shared protocol types between the Cloudflare realtime service and the
 * client SDK (apps/web/lib/realtime/).
 *
 * Wire format is JSON. One WebSocket = one room (Durable Object) identified
 * by the `?room=` query param on /ws. Clients can subscribe/unsubscribe to
 * logical topics within that room.
 */

/** Server → client. Sent immediately after the socket is accepted. */
export interface HelloMessage {
  t: "hello";
  room: string;
  connectionId: string;
}

/** Server → client. A published event for this room. */
export interface EventMessage {
  t: "event";
  room: string;
  topic: string;
  data: unknown;
  sender?: string;
}

/** Server → client. Presence snapshot (full list on join, deltas after). */
export interface PresenceUser {
  id: string;
  name: string | null;
  avatar: string | null;
  connections: number;
}

export interface PresenceMessage {
  t: "presence";
  room: string;
  users: PresenceUser[];
}

/** Server → client. Delta event when a user joins or leaves. */
export interface PresenceDeltaMessage {
  t: "presence_delta";
  room: string;
  joined?: PresenceUser;
  left?: { id: string };
}

/** Server → client. */
export interface ErrorMessage {
  t: "error";
  message: string;
}

/** Client → server. Must be the first message; declares identity for the room. */
export interface JoinMessage {
  t: "join";
  user: { id: string; name: string; avatar: string | null };
}

/** Client → server. Subscribe to a logical topic within this room. */
export interface SubscribeMessage {
  t: "subscribe";
  topic: string;
}

/** Client → server. Unsubscribe from a logical topic within this room. */
export interface UnsubscribeMessage {
  t: "unsubscribe";
  topic: string;
}

/** Client → server. Low-trust publish (typing, presence heartbeat). Rebroadcast to other members of the room. */
export interface PublishMessage {
  t: "publish";
  topic: string;
  data: unknown;
}

export type ClientMessage =
  | JoinMessage
  | SubscribeMessage
  | UnsubscribeMessage
  | PublishMessage;

export type ServerMessage =
  | HelloMessage
  | EventMessage
  | PresenceMessage
  | PresenceDeltaMessage
  | ErrorMessage;

/** Server-to-server publish payload for POST /publish. */
export interface PublishRequest {
  room: string;
  topic: string;
  data: unknown;
  exclude_user?: string;
}