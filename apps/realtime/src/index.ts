import { jwtVerify } from "jose";
import type { Env } from "./env";
import { resolveRoomTarget } from "./room-routing";
import { runBoundedPool } from "./subscriptions";
import { isRetryableStatus, retryWithBackoff } from "./retry";
import { logEvent } from "./log";
export { UserDO } from "./user";
export { Room } from "./room";
export { resolveRoomTarget, USER_ROOM_PREFIXES } from "./room-routing";

const SESSION_COOKIE = "uxcommunity_session";
const LEGACY_SESSION_COOKIE = "draft_session";

/**
 * How many Durable Object deliveries to keep in flight. Bounded so a huge
 * fan-out cannot spawn an unbounded number of simultaneous subrequests.
 */
const FANOUT_CONCURRENCY = 40;

/**
 * Bounded retry for a single room delivery (production-readiness audit, M-1).
 *
 * DURABILITY BOUNDARY: this absorbs a transient blip (a moment of DO
 * unavailability, a reset connection, a 429/5xx) — it is NOT a durable queue,
 * so an outage longer than the retry budget still loses that room's event. The
 * database stays the source of truth and connected clients resync on
 * reconnect/visibility; this only narrows the window in which a live client
 * could miss an event. Retries reuse the event's `event_id`, and the room DO
 * de-duplicates by it, so a retry cannot double-deliver.
 */
const FANOUT_RETRY_ATTEMPTS = 3;
const FANOUT_RETRY_BASE_MS = 60;
const FANOUT_RETRY_MAX_MS = 300;
const FANOUT_RETRY_JITTER = 0.3;

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

async function verifyJwt(token: string, secret: string): Promise<{ userId?: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret));
    return payload as unknown as { userId?: string };
  } catch {
    return null;
  }
}

function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    cookies.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
  }
  return cookies;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      return handleUpgrade(request, env, url);
    }
    if (url.pathname === "/publish") {
      return handlePublish(request, env, ctx);
    }
    if (url.pathname === "/stats") {
      return handleStats(request, env, url);
    }
    return new Response("Not found", { status: 404 });
  },
};

async function handleUpgrade(request: Request, env: Env, url: URL): Promise<Response> {
  const room = url.searchParams.get("room");
  if (!room) {
    return new Response("Missing room", { status: 400 });
  }

  // Authenticate via the same JWT the web app issues.
  const cookies = parseCookies(request.headers.get("Cookie"));
  const cookieToken = cookies.get(SESSION_COOKIE) ?? cookies.get(LEGACY_SESSION_COOKIE);
  const queryToken = url.searchParams.get("token");
  const token = cookieToken ?? queryToken;
  const session = token ? await verifyJwt(token, env.SESSION_SECRET) : null;
  const userId = session?.userId;
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  // A user-scoped room name (`user:${userId}`) is already resolved; community
  // rooms keep their own name. Both go to the namespace that owns them.
  const { namespace, name } = resolveRoomTarget(env, room);
  const stub = namespace.get(namespace.idFromName(name));

  const forwarded = new Request(request, {
    headers: new Headers([
      ...request.headers,
      ["x-realtime-uid", userId],
    ]),
  });
  return stub.fetch(forwarded);
}

async function handleStats(request: Request, env: Env, url: URL): Promise<Response> {
  if (request.headers.get("x-realtime-publish-secret") !== env.REALTIME_PUBLISH_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }
  const room = url.searchParams.get("room");
  if (!room) {
    return new Response("Missing room", { status: 400 });
  }
  const { namespace, name } = resolveRoomTarget(env, room);
  const stub = namespace.get(namespace.idFromName(name));
  return stub.fetch(
    new Request(request.url, {
      method: "GET",
      headers: {
        "x-realtime-stats": env.REALTIME_PUBLISH_SECRET,
      },
    }),
  );
}

async function handlePublish(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.headers.get("x-realtime-publish-secret") !== env.REALTIME_PUBLISH_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  let body: {
    room?: string;
    topic?: string;
    data?: unknown;
    exclude_user?: string;
    event_id?: string;
    events?: Array<{
      room: string;
      topic: string;
      data?: unknown;
      exclude_user?: string;
      event_id?: string;
    }>;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const events = Array.isArray(body.events)
    ? body.events
    : body.room && body.topic
      ? [{
          room: body.room,
          topic: body.topic,
          data: body.data,
          exclude_user: body.exclude_user,
          event_id: body.event_id,
        }]
      : [];

  if (!events.length) {
    return new Response("Missing room", { status: 400 });
  }

  // Fan out in the background at bounded concurrency. Returning before the
  // fan-out finishes means a community-sized fan-out is never truncated by the
  // caller's request timeout (the web app aborts /publish after 3s), and the
  // caller's latency stays flat no matter how many rooms are targeted.
  ctx.waitUntil(fanOutEvents(env, request.url, events));
  return new Response("ok");
}

/**
 * Deliver every event to its room's Durable Object.
 *
 * A fixed pool of workers pulls from a shared cursor instead of sequential
 * chunks: awaiting chunks of 40 one after another made wall-clock time grow
 * with `events.length`, so later chunks sat idle behind earlier ones and a
 * large fan-out could outlive the publisher's timeout.
 *
 * Failures are per-event: one unreachable room never stops the rest.
 */
interface FanOutEvent {
  room: string;
  topic: string;
  data?: unknown;
  exclude_user?: string;
  event_id?: string;
}

/**
 * Deliver one event to one room, retrying only TRANSIENT failures.
 *
 * Retryable: a thrown fetch error (connection reset, DNS blip) and a 429/5xx
 * from the DO. Permanent: any 2xx (delivered) or 4xx (the request is wrong).
 * Retries reuse `event_id`, so a retry that races a successful attempt is
 * dropped by the DO rather than delivered twice.
 */
async function deliverToRoom(
  env: Env,
  requestUrl: string,
  event: FanOutEvent,
): Promise<Response> {
  const { namespace, name } = resolveRoomTarget(env, event.room);
  const stub = namespace.get(namespace.idFromName(name));

  return retryWithBackoff(
    () =>
      stub.fetch(
        new Request(requestUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-realtime-publish-secret": env.REALTIME_PUBLISH_SECRET,
          },
          // `room` stays the LOGICAL room: the DO filters deliveries by its own
          // subscription table, which is keyed by logical room name.
          body: JSON.stringify({
            room: event.room,
            topic: event.topic,
            data: event.data ?? null,
            exclude_user: event.exclude_user,
            event_id: event.event_id,
          }),
        }),
      ),
    {
      attempts: FANOUT_RETRY_ATTEMPTS,
      baseDelayMs: FANOUT_RETRY_BASE_MS,
      maxDelayMs: FANOUT_RETRY_MAX_MS,
      jitter: FANOUT_RETRY_JITTER,
    },
    ({ value, error }) => (error ? true : value ? isRetryableStatus(value.status) : false),
    {
      onRetry: ({ attempt, delayMs }) =>
        logEvent("warn", {
          event: "realtime.publish.fanout_retry",
          room: event.room,
          topic: event.topic,
          attempt,
          delay_ms: delayMs,
        }),
    },
  );
}

async function fanOutEvents(
  env: Env,
  requestUrl: string,
  events: FanOutEvent[],
): Promise<void> {
  await runBoundedPool(events, FANOUT_CONCURRENCY, async (event) => {
    try {
      const response = await deliverToRoom(env, requestUrl, event);
      if (!response.ok) {
        // Retries exhausted on a transient status — the room did not receive it.
        logEvent("error", {
          event: "realtime.publish.fanout_failed",
          room: event.room,
          topic: event.topic,
          status: response.status,
        });
      }
    } catch (error) {
      // Best-effort: a failed room must not stop the rest of the fan-out.
      logEvent("error", {
        event: "realtime.publish.fanout_failed",
        room: event.room,
        topic: event.topic,
        error,
      });
    }
  });
}
