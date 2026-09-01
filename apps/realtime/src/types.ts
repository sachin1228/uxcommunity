/**
 * Wire-protocol types for the Cloudflare realtime service.
 *
 * All messages are JSON. The `room` field is required on every client→server
 * message and included on every server→client event so the client can route
 * to the correct handler.
 *
 * Connection model (USE_WEBSOCKET_OWNERSHIP=true):
 *   Client → CommunityDO (direct WebSocket) → ws.send() → Client(s)
 *   0 RPCs for message delivery.
 *
 * Connection model (USE_WEBSOCKET_OWNERSHIP=false, legacy):
 *   Client → UserDO (user:${userId}) → Community DOs
 */

// ── Server → Client ────────────────────────────────────────────────────────

export interface HelloMessage {
  t: "hello";
  connectionId: string;
}

export interface EventMessage {
  t: "event";
  room: string;
  topic: string;
  data: unknown;
  sender?: string;
}

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

export interface PresenceDeltaMessage {
  t: "presence_delta";
  room: string;
  joined?: PresenceUser;
  left?: { id: string };
}

export interface ErrorMessage {
  t: "error";
  message: string;
}

// ── Client → Server ────────────────────────────────────────────────────────

export interface JoinMessage {
  t: "join";
  user: { id: string; name: string; avatar: string | null };
}

export interface SubscribeMessage {
  t: "subscribe";
  room: string;
  topic: string;
}

export interface UnsubscribeMessage {
  t: "unsubscribe";
  room: string;
  topic: string;
}

export interface PublishMessage {
  t: "publish";
  room: string;
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
