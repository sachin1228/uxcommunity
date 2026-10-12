import "server-only";
import { publishRealtimeBatch } from "@/lib/realtime/publish";
import { realtimeRooms } from "@/lib/realtime/rooms";

/**
 * Publish one DM event to both participants' user sockets.
 *
 * Every DM event is delivered to TWO rooms — `dm:${userA}` and `dm:${userB}`
 * — because both sides need it: the recipient for the live update, the sender
 * for their OTHER tabs/devices (the tab that sent resolves its optimistic
 * bubble via the HTTP response; echoes dedupe by message id client-side,
 * exactly like the community chat's self-echo).
 *
 * Both rooms live on each participant's existing user Durable Object (see
 * apps/realtime room-routing `dm:` prefix), so a message costs one `/publish`
 * request with a two-event batch and touches zero extra sockets — no
 * per-conversation Durable Object and no new WebSocket per chat.
 *
 * Fire-and-forget from `after()`: the DB row is the source of truth, and a
 * missed event is corrected by the client's next catch-up fetch.
 */
export async function publishDmEvent(params: {
  /** The conversation's two participant ids (order irrelevant). */
  participants: readonly string[];
  topic: string;
  data: unknown;
}): Promise<void> {
  const recipients = [...new Set(params.participants)];
  await publishRealtimeBatch(
    recipients.map((userId) => ({
      room: realtimeRooms.dm(userId),
      topic: params.topic,
      data: params.data,
    })),
  );
}
