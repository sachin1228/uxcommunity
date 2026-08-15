import "server-only";

/**
 * Server-side helper to publish events to the Cloudflare realtime service.
 * Call AFTER a successful DB write so connected clients get the event.
 *
 * Fire-and-forget by design: realtime delivery is best-effort and any missed
 * event is corrected by the next client-side poll/catch-up, so this never
 * blocks the write path or fails a request.
 */

const REALTIME_URL = process.env.REALTIME_URL ?? "";
const REALTIME_PUBLISH_SECRET = process.env.REALTIME_PUBLISH_SECRET ?? "";

export interface PublishPayload {
  room: string;
  topic: string;
  data: unknown;
  excludeUser?: string;
}

export async function publishRealtime(payload: PublishPayload): Promise<void> {
  if (!REALTIME_URL || !REALTIME_PUBLISH_SECRET) return;
  try {
    await fetch(`${REALTIME_URL}/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-realtime-publish-secret": REALTIME_PUBLISH_SECRET,
      },
      body: JSON.stringify({
        room: payload.room,
        topic: payload.topic,
        data: payload.data,
        ...(payload.excludeUser ? { exclude_user: payload.excludeUser } : {}),
      }),
      signal: AbortSignal.timeout(1500),
    });
  } catch (error) {
    console.error("[realtime] publish failed", error);
  }
}

/**
 * Publish several events in one request. The Worker fans each out to its own
 * room's Durable Object, so a single fan-out (e.g. one chat message → the chat
 * room + every member's sidebar panel room) costs one HTTP call.
 */
export async function publishRealtimeBatch(events: PublishPayload[]): Promise<void> {
  if (!events.length) return;
  if (!REALTIME_URL || !REALTIME_PUBLISH_SECRET) return;
  try {
    await fetch(`${REALTIME_URL}/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-realtime-publish-secret": REALTIME_PUBLISH_SECRET,
      },
      body: JSON.stringify({
        events: events.map((event) => ({
          room: event.room,
          topic: event.topic,
          data: event.data,
          ...(event.excludeUser ? { exclude_user: event.excludeUser } : {}),
        })),
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch (error) {
    console.error("[realtime] batch publish failed", error);
  }
}

export const realtimeRooms = {
  chat: (communityId: string) => `chat:${communityId}`,
  presence: (communityId: string) => `presence:${communityId}`,
  typing: (communityId: string) => `typing:${communityId}`,
  panel: (userId: string) => `panel:${userId}`,
  profile: (userId: string) => `profile:${userId}`,
  notifications: (userId: string) => `notifications:${userId}`,
  threads: (communityId: string) => `threads:${communityId}`,
  threadComments: (threadId: string) => `thread-comments:${threadId}`,
  events: (communityId: string) => `events:${communityId}`,
  resources: (communityId: string) => `resources:${communityId}`,
  resourceComments: (resourceId: string) => `resource-comments:${resourceId}`,
  showcase: (postId: string) => `showcase:${postId}`,
  rules: (communityId: string) => `rules:${communityId}`,
} as const;