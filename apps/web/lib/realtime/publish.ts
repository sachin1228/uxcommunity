import "server-only";
import { logEvent } from "@/lib/observability/log";
import { isRetryableStatus, retryWithBackoff } from "./publish-retry";

/**
 * Server-side helper to publish events to the Cloudflare realtime service.
 * Call AFTER a successful DB write so connected clients get the event.
 *
 * Delivery model (production-readiness audit, M-1):
 *   The database stays the source of truth — a missed event is corrected by the
 *   client's next catch-up (reconnect / visibility / message-page load) — so
 *   this never blocks the write path or fails a request. What it does NOT do is
 *   give up after a single transient blip: each publish is retried a bounded
 *   number of times, with exponential backoff + jitter, for retryable outcomes
 *   only (thrown network errors and 429/5xx).
 *
 * Duplicate safety:
 *   Every event carries a stable `event_id` that is reused by each retry. The
 *   receiving Durable Object drops an id it has already applied, so a retry
 *   cannot double-deliver. This is a retry, not a durable queue: an outage
 *   longer than the retry budget still drops the event, to be recovered from
 *   the database by client catch-up.
 */

// Re-exported for server-side callers; Client Components should import from
// "@/lib/realtime/rooms" directly.
export { realtimeRooms } from "@/lib/realtime/rooms";

const REALTIME_URL = process.env.REALTIME_URL ?? "";
const REALTIME_PUBLISH_SECRET = process.env.REALTIME_PUBLISH_SECRET ?? "";

/** Bounded, jittered retry for one publish request. */
const PUBLISH_RETRY_ATTEMPTS = 3;
const PUBLISH_RETRY_BASE_MS = 80;
const PUBLISH_RETRY_MAX_MS = 400;
const PUBLISH_RETRY_JITTER = 0.3;

export interface PublishPayload {
  room: string;
  topic: string;
  data: unknown;
  excludeUser?: string;
}

/** Stable per-event id, reused across retries and de-duplicated by the DO. */
function newEventId(): string {
  return crypto.randomUUID();
}

/**
 * POST a publish body to the realtime Worker, retrying transient failures.
 * Never throws — the caller is a fire-and-forget `after()` callback.
 */
async function postPublish(body: unknown, eventCount: number): Promise<void> {
  if (!REALTIME_URL || !REALTIME_PUBLISH_SECRET) return;

  try {
    const response = await retryWithBackoff(
      () =>
        fetch(`${REALTIME_URL}/publish`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-realtime-publish-secret": REALTIME_PUBLISH_SECRET,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(3000),
        }),
      {
        attempts: PUBLISH_RETRY_ATTEMPTS,
        baseDelayMs: PUBLISH_RETRY_BASE_MS,
        maxDelayMs: PUBLISH_RETRY_MAX_MS,
        jitter: PUBLISH_RETRY_JITTER,
      },
      ({ value, error }) => (error ? true : value ? isRetryableStatus(value.status) : false),
      {
        onRetry: ({ attempt, delayMs }) =>
          logEvent("warn", {
            event: "realtime.publish.retry",
            attempt,
            delay_ms: delayMs,
            events: eventCount,
          }),
      },
    );

    if (!response.ok) {
      logEvent("error", {
        event: "realtime.publish.failed",
        status: response.status,
        events: eventCount,
      });
    }
  } catch (error) {
    logEvent("error", { event: "realtime.publish.failed", events: eventCount, error });
  }
}

export async function publishRealtime(payload: PublishPayload): Promise<void> {
  if (!REALTIME_URL || !REALTIME_PUBLISH_SECRET) return;
  await postPublish(
    {
      room: payload.room,
      topic: payload.topic,
      data: payload.data,
      event_id: newEventId(),
      ...(payload.excludeUser ? { exclude_user: payload.excludeUser } : {}),
    },
    1,
  );
}

/**
 * Publish several events in one request. The Worker routes each event to its
 * room's Durable Object (community rooms to that community's `Room`, user rooms
 * to the recipient's `UserDO`), so a batch spanning many rooms costs one HTTP
 * call. Each event carries its own `event_id` so per-room retries stay
 * idempotent.
 */
export async function publishRealtimeBatch(events: PublishPayload[]): Promise<void> {
  if (!events.length) return;
  if (!REALTIME_URL || !REALTIME_PUBLISH_SECRET) return;
  await postPublish(
    {
      events: events.map((event) => ({
        room: event.room,
        topic: event.topic,
        data: event.data,
        event_id: newEventId(),
        ...(event.excludeUser ? { exclude_user: event.excludeUser } : {}),
      })),
    },
    events.length,
  );
}
