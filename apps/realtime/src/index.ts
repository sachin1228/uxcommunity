import { jwtVerify } from "jose";
import type { Env } from "./env";
export { Room } from "./room";

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      return handleUpgrade(request, env, url);
    }
    if (url.pathname === "/publish") {
      return handlePublish(request, env);
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
  const token =
    cookies.get(SESSION_COOKIE) ?? cookies.get(LEGACY_SESSION_COOKIE);
  const session = token ? await verifyJwt(token, env.SESSION_SECRET) : null;
  const userId = session?.userId;
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const id = env.ROOM.idFromName(room);
  const stub = env.ROOM.get(id);

  // Forward the upgrade to the room's Durable Object, carrying the verified
  // user id on a header the DO trusts (Worker→DO is within the same project).
  const forwarded = new Request(request, {
    headers: new Headers([
      ...request.headers,
      ["x-realtime-uid", userId],
    ]),
  });
  return stub.fetch(forwarded);
}

async function handlePublish(request: Request, env: Env): Promise<Response> {
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

  // Accept a single event (backward compatible) or a batched fan-out.
  const events = Array.isArray(body.events)
    ? body.events
    : body.room && body.topic
      ? [{ room: body.room, topic: body.topic, data: body.data, exclude_user: body.exclude_user }]
      : [];

  if (!events.length) {
    return new Response("Missing room", { status: 400 });
  }

  // Fan-out can exceed the 50-subrequest cap per Worker invocation, so process
  // the events in sequential chunks (each chunk runs its DO fetches in parallel).
  const CHUNK = 40;
  for (let i = 0; i < events.length; i += CHUNK) {
    const chunk = events.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map(async (event) => {
        const id = env.ROOM.idFromName(event.room);
        const stub = env.ROOM.get(id);
        return stub.fetch(
          new Request(request.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-realtime-publish-secret": env.REALTIME_PUBLISH_SECRET,
            },
            body: JSON.stringify({
              room: event.room,
              topic: event.topic,
              data: event.data ?? null,
              exclude_user: event.exclude_user,
            }),
          }),
        );
      }),
    );
  }

  return new Response("ok");
}