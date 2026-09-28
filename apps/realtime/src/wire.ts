/**
 * The realtime wire format.
 *
 * WHY THIS EXISTS
 *   The server→client frames were serialized at three separate call sites (the
 *   community DO's fan-out, the user DO's HTTP publish, and the user DO's
 *   client-publish broadcast) and the server→server publish body was decoded in
 *   two. Nothing owned the shape they had to agree on, so `event` could drift
 *   between the two Durable Objects without any test noticing — the frames are
 *   the one part of this service a client parses, and they are frozen.
 *
 *   This module is that owner. It builds the exact bytes the previous inline
 *   `JSON.stringify` calls produced, including key ORDER (payload byte counts
 *   are measured for the fan-out metrics) and the fact that an absent `sender`
 *   is an omitted key rather than `null` (a plain `JSON.stringify` drops
 *   `undefined` values).
 *
 * SCOPE
 *   Encoding server→client frames and decoding the secret-authenticated publish
 *   body. It deliberately does not own delivery: the community DO fans out by
 *   topic and the user DO by (room, topic), each with its own accounting, and
 *   collapsing those two loops behind one interface would mean a parameter bag
 *   rather than a shared responsibility.
 */

import type { PublishRequest } from "./types";

/** Fields of a server→client `event` frame. */
export interface EventFrame {
  room: string;
  topic: string;
  data: unknown;
  /**
   * The publisher's user id, echoed to the client. ABSENT for a server-authored
   * event (the previous inline encoders passed an undefined value, which
   * `JSON.stringify` omits) — never `null`.
   */
  sender?: string;
}

/**
 * Serialize an `event` frame.
 *
 * Key order is part of the output: the community DO measures the frame's byte
 * length for `eventPayloadBytes`, so reordering the object would change an
 * operational metric without changing a single client behaviour.
 */
export function encodeEventFrame(frame: EventFrame): string {
  return JSON.stringify({
    t: "event",
    room: frame.room,
    topic: frame.topic,
    data: frame.data,
    sender: frame.sender,
  });
}

/**
 * Serialize the room's online-member count.
 *
 * The payload is a bare number by design (see `PresenceMessage`): the only
 * presence consumer in the product renders "N online", so a roster added
 * nothing but bytes.
 */
export function encodePresenceFrame(room: string, count: number): string {
  return JSON.stringify({
    t: "presence",
    room,
    count,
  });
}

/**
 * The frame that acknowledges a `join`.
 *
 * Returned as an object because both DOs hand it to their own
 * `sendToClient` (which serializes), so its shape lives here while the
 * serialization stays with the socket it is written to.
 */
export function helloFrame(connectionId: string): { t: "hello"; connectionId: string } {
  return { t: "hello", connectionId };
}

/**
 * Decode the body of a secret-authenticated `POST /publish` request.
 *
 * Returns null for an unreadable body or one missing `room`/`topic`; both DOs
 * answer that with the same 400, which is why the decision lives here rather
 * than being repeated at each handler.
 */
export async function readPublishRequest(request: Request): Promise<PublishRequest | null> {
  let body: PublishRequest;
  try {
    body = (await request.json()) as PublishRequest;
  } catch {
    return null;
  }
  if (!body.room || !body.topic) return null;
  return body;
}
