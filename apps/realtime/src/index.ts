import { jwtVerify } from "jose";
import type { Env } from "./env";
import { resolveRoomTarget } from "./room-routing";
export { UserDO } from "./user";
export { Room } from "./room";
export { resolveRoomTarget, USER_ROOM_PREFIXES } from "./room-routing";

const SESSION_COOKIE = "uxcommunity_session";
const LEGACY_SESSION_COOKIE = "draft_session";

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

/** Community-scoped room prefixes that route to CommunityDO for WebSocket ownership. */
const COMMUNITY_ROOM_PREFIXES = [
  "chat:",
  "threads:",
  "events:",
  "resources:",
  "showcase:",
  "rules:",
  "thread-comments:",
  "resource-comments:",
];

function isCommunityRoom(room: string): boolean {
  return COMMUNITY_ROOM_PREFIXES.some((prefix) => room.startsWith(prefix));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Redact sensitive query params from any logging
    const safeUrl = new URL(url);
    if (safeUrl.searchParams.has("token")) safeUrl.searchParams.set("token", "[REDACTED]");

    if (url.pathname === "/ws") {
      return handleUpgrade(request, env, url);
    }
    if (url.pathname === "/publish") {
      return handlePublish(request, env, ctx);
    }
    return new Response("Not found", { status: 404 });
  },
};

/**
 * How many Durable Object deliveries to keep in flight. Bounded so a huge
 * fan-out cannot spawn an unbounded number of simultaneous subrequests.
 */
const FANOUT_CONCURRENCY = 40;

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

  const isUserRoom = room.startsWith("user:");

  let namespace: DurableObjectNamespace;
  if (isUserRoom) {
    namespace = env.USER_DO;
  } else {
    namespace = env.COMMUNITY_DO;
  }

  const id = namespace.idFromName(room);
  const stub = namespace.get(id);

  const forwarded = new Request(request, {
    headers: new Headers([
      ...request.headers,
      ["x-realtime-uid", userId],
    ]),
  });
  return stub.fetch(forwarded);
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
    events?: Array<{
      room: string;
      topic: string;
      data?: unknown;
      exclude_user?: string;
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
      ? [{ room: body.room, topic: body.topic, data: body.data, exclude_user: body.exclude_user }]
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
 * Implemented as a fixed pool of workers pulling from a shared cursor instead
 * of sequential batches: earlier revisions awaited chunks of 40 one after
 * another, so wall-clock time grew with `events.length` and later chunks sat
 * idle behind earlier ones.
 */
async function fanOutEvents(
  env: Env,
  requestUrl: string,
  events: Array<{ room: string; topic: string; data?: unknown; exclude_user?: string }>,
): Promise<void> {
  let cursor = 0;
  const poolSize = Math.min(FANOUT_CONCURRENCY, events.length);

  const workers = Array.from({ length: poolSize }, async () => {
    while (cursor < events.length) {
      const event = events[cursor++];
      const { namespace, name } = resolveRoomTarget(env, event.room);
      try {
        const stub = namespace.get(namespace.idFromName(name));
        await stub.fetch(
          new Request(requestUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-realtime-publish-secret": env.REALTIME_PUBLISH_SECRET,
            },
            // `room` stays the LOGICAL room: the DO filters deliveries by its
            // own subscription table, which is keyed by logical room name.
            body: JSON.stringify({
              room: event.room,
              topic: event.topic,
              data: event.data ?? null,
              exclude_user: event.exclude_user,
            }),
          }),
        );
      } catch (error) {
        // Best-effort: a failed room must not stop the rest of the fan-out.
        console.error("[realtime] publish fan-out failed", event.room, error);
      }
    }
  });

  await Promise.all(workers);
}
