import { assertServiceUrl, jobsEnabled } from "../../../packages/shared/src/environment";
import { jwtVerify } from "jose";
import type { Env } from "./env";
import {
  isUserScopedRoomAllowed,
  resolveRoomTarget,
  USER_ROOM_PREFIXES,
} from "./room-routing";
import {
  secretMatches,
  validateSessionWithApi,
} from "./session-validation";
import { resolveSessionConfig } from "./session-config";
import { runBoundedPool } from "./subscriptions";
import { isRetryableStatus, retryWithBackoff } from "./retry";
import { logEvent } from "./log";
import { runRetentionSweep } from "./retention";
import { runEventLifecycleNotifications } from "./event-notifications";
import { runVerificationReapplyEmails } from "./verification-emails";
export { UserDO } from "./user";
export { Room } from "./room";
export { AlertMonitor } from "./alert-monitor";
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

/**
 * One line per isolate when the session secret is missing.
 *
 * The membership authorizer already reports its own missing configuration (see
 * membership-auth.ts `config_missing`); this is the same signal for the layer
 * ABOVE it, because a Worker that cannot verify a session refuses every socket
 * in the app while `/publish` keeps answering "ok". Repeated per-connection
 * logs would be noise, so it fires once per isolate.
 */
let warnedMissingSessionSecret = false;
function warnMissingSessionSecretOnce(): void {
  if (warnedMissingSessionSecret) return;
  warnedMissingSessionSecret = true;
  logEvent("error", { event: "realtime.session.config_missing" });
}

interface SessionClaims {
  userId?: string;
  sid?: string;
  sv?: number;
  role?: string;
}

async function verifyJwt(token: string, secret: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(secret));
    return payload as unknown as SessionClaims;
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

/**
 * The cron expressions declared in wrangler.toml, routed in `scheduled`.
 *
 * Module-local by necessity: every named export of this entry module is
 * registered as an entrypoint, and workerd refuses to start when one is not a
 * function or ExportedHandler (string constants included).
 */
const ALERT_MONITOR_CRON = "*/5 * * * *";
const RETENTION_SWEEP_CRON = "0 */6 * * *";
const EVENT_LIFECYCLE_CRON = "* * * * *";

export default {
  /**
   * Cron entry point. Every expression in wrangler.toml's [triggers] fires
   * this handler; the expression tells the jobs apart.
   *
   *   * (every 5 min) — the dependency monitor (see src/alert-monitor.ts). The
   *     tick is deliberately thin: hand it to the Durable Object, which owns
   *     the state that decides whether this run is news or a repeat. The same
   *     fetch handler is reachable at /__scheduled under
   *     `wrangler dev --test-scheduled`.
   *   * (every 6 h) — the community chat retention sweep (see src/retention.ts).
   *     Stateless: a POST to the web app, which owns the deletion itself.
   *   * (every minute) — event lifecycle notifications (see
   *     src/event-notifications.ts) and reapply-eligible verification emails
   *     (see src/verification-emails.ts). Same stateless POST shape; the web
   *     app owns the clocks, the ledgers and the push.
   */
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (!jobsEnabled({ APP_ENV: env.APP_ENV })) return;
    if (controller.cron === RETENTION_SWEEP_CRON) {
      await runRetentionSweep(env);
      return;
    }
    if (controller.cron === EVENT_LIFECYCLE_CRON) {
      await runEventLifecycleNotifications(env);
      // The reapply email is due once a member's one-month window opens; the
      // per-user sent timestamp makes a minute tick cheap and idempotent.
      await runVerificationReapplyEmails(env);
      return;
    }
    if (controller.cron !== ALERT_MONITOR_CRON) {
      // An expression this handler does not know (e.g. one added to the toml
      // without a branch here): run the monitor, which is the historical
      // default, and make the mismatch findable in the logs.
      logEvent("warn", { event: "realtime.scheduled.unknown_cron", cron: controller.cron });
    }
    await env.ALERT_MONITOR.get(env.ALERT_MONITOR.idFromName(ALERT_MONITOR_NAME)).fetch(
      "https://alert-monitor/run",
      { method: "POST" },
    );
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    assertServiceUrl(env.API_URL, { APP_ENV: env.APP_ENV, STAGING_ALLOWED_ORIGINS: env.STAGING_ALLOWED_ORIGINS });
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      return handleUpgrade(request, env, url);
    }
    if (url.pathname === "/publish") {
      return handlePublish(request, env, ctx);
    }
    if (url.pathname === "/revoke") {
      return handleRevoke(request, env);
    }
    if (url.pathname === "/stats") {
      return handleStats(request, env, url);
    }
    if (url.pathname === "/health-monitor") {
      return handleHealthMonitorState(request, env);
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

  // FAIL CLOSED on missing configuration, and make it observable: an
  // unverifiable token must never open a socket, and a Worker running without
  // SESSION_SECRET — a deploy that staged the secret into a version it did not
  // publish, for example — otherwise refuses every handshake in the app with a
  // bare 401 that nothing in these logs explains.
  const { configured, secret } = resolveSessionConfig(env);
  if (!configured) warnMissingSessionSecretOnce();

  const session = token && secret ? await verifyJwt(token, secret) : null;
  const userId = session?.userId;
  const sid = session?.sid;
  const sv = session?.sv;

  // Admin tokens are not valid for user sockets, and a token without the
  // registry claims predates revocation support.
  if (
    !userId ||
    !sid ||
    typeof sv !== "number" ||
    session?.role !== "user"
  ) {
    return new Response("Unauthorized", { status: 401 });
  }

  // A user-scoped room (user:, notifications:, profile:, dm:) is an instance
  // keyed by the member it belongs to — opening one for someone ELSE would
  // attach this socket to their private stream. Community rooms are authorized
  // by their Durable Object instead, so only user-scoped names are checked.
  if (!isUserScopedRoomAllowed(room, userId)) {
    return new Response("Forbidden", { status: 403 });
  }

  // Signature alone is not enough: the registry row must still be live. This
  // is the only database-backed check on the socket's lifetime.
  const active = await validateSessionWithApi(env, { userId, sid, sv });
  if (!active) {
    return new Response("Unauthorized", { status: 401 });
  }

  // A user-scoped room name (`user:${userId}`) is already resolved; community
  // rooms keep their own name. Both go to the namespace that owns them.
  const isUserRoom =
    room.startsWith("user:") ||
    USER_ROOM_PREFIXES.some((prefix) => room.startsWith(prefix));
  const { namespace, name } = resolveRoomTarget(env, room);
  const stub = namespace.get(namespace.idFromName(name));

  const headers = new Headers(request.headers);
  headers.set("x-realtime-uid", userId);
  headers.set("x-realtime-sid", sid);
  headers.set("x-realtime-sv", String(sv));
  // The DO authorizes from these headers, never from a client cookie.
  headers.delete("cookie");

  const forwarded = new Request(request, { headers });
  const response = await stub.fetch(forwarded);
  if (response.status !== 101) return response;

  // Register the community room AFTER the socket exists. Doing it before the
  // membership check let a failed handshake (or a close racing the accept)
  // leave a room key that did not correspond to a live socket, and the reverse
  // ordering could delete a key for a socket that had just been accepted. Once
  // the socket is tracked, registration is safe: an old socket closing cannot
  // unregister a user who still has this new socket in the room.
  if (!isUserRoom) {
    const registered = await registerRoomForRevocation(env, userId, room);
    if (!registered) {
      logEvent("error", { event: "realtime.revoke.registration_failed", room });
      try {
        response.webSocket?.close(1011, "realtime unavailable");
      } catch {
        // Already closing.
      }
      // The user DO never learned about this room, so close the server end
      // directly before refusing the socket.
      try {
        await stub.fetch("https://room/revoke", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-realtime-publish-secret": env.REALTIME_PUBLISH_SECRET,
          },
          body: JSON.stringify({ userId, sid }),
          signal: AbortSignal.timeout(2_000),
        });
      } catch {
        // The client end is already closed; a stale DO socket cannot
        // revalidate and will close on its next transport failure.
      }
      return response;
    }
  }

  // A revocation can commit after the pre-upgrade check but before the DO
  // accepts the socket. Revalidate once the socket exists: if the session died
  // in that window, close it and make the user's DO remove the server end too.
  // A revocation that lands after this second read is covered by the web app's
  // revocation push, because the room registration above already exists.
  const stillActive = await validateSessionWithApi(env, { userId, sid, sv });
  if (!stillActive) {
    try {
      response.webSocket?.close(4001, "session revoked");
    } catch {
      // Already closing; the DO cleanup below is still required.
    }
    await revokeUserSessions(env, userId, { sid });
  }

  return response;
}

/** Ask a user's DO to close matching sockets and fan the selector into rooms. */
async function revokeUserSessions(
  env: Env,
  userId: string,
  selector: { sid?: string; exceptSid?: string; all?: boolean },
): Promise<void> {
  try {
    const stub = env.USER_DO.get(env.USER_DO.idFromName(`user:${userId}`));
    await stub.fetch("https://user/revoke", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-realtime-publish-secret": env.REALTIME_PUBLISH_SECRET,
        "x-realtime-uid": userId,
      },
      body: JSON.stringify({ userId, ...selector }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    logEvent("error", { event: "realtime.revoke.post_upgrade_failed", userId, error });
  }
}

/** Tell a user's DO that a community room holds a live socket for them. */
async function registerRoomForRevocation(
  env: Env,
  userId: string,
  room: string,
): Promise<boolean> {
  try {
    const stub = env.USER_DO.get(env.USER_DO.idFromName(`user:${userId}`));
    const response = await stub.fetch("https://user/register-room", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-realtime-publish-secret": env.REALTIME_PUBLISH_SECRET,
      },
      body: JSON.stringify({ room }),
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Web → realtime revocation push.
 *
 * The web app has already committed the registry revocation; this endpoint is
 * the fast path that closes existing sockets. It returns 502 if any community
 * room could not be notified, which makes the web helper retry.
 */
async function handleRevoke(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get("authorization");
  const provided = auth?.startsWith("Bearer ")
    ? auth.slice("Bearer ".length)
    : request.headers.get("x-realtime-publish-secret");

  if (!secretMatches(provided, env.REALTIME_PUBLISH_SECRET)) {
    return new Response("Forbidden", { status: 403 });
  }

  let body: {
    userId?: unknown;
    sid?: unknown;
    exceptSid?: unknown;
    all?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const userId = typeof body?.userId === "string" ? body.userId : null;
  const sid = typeof body?.sid === "string" ? body.sid : undefined;
  const exceptSid = typeof body?.exceptSid === "string" ? body.exceptSid : undefined;
  const all = body?.all === true;

  if (!userId || (!all && !sid && !exceptSid)) {
    return new Response("Bad request", { status: 400 });
  }

  const stub = env.USER_DO.get(env.USER_DO.idFromName(`user:${userId}`));
  try {
    const response = await stub.fetch("https://user/revoke", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-realtime-publish-secret": env.REALTIME_PUBLISH_SECRET,
        "x-realtime-uid": userId,
      },
      body: JSON.stringify({ userId, sid, exceptSid, all }),
      signal: AbortSignal.timeout(10_000),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    logEvent("error", { event: "realtime.revoke.failed", userId, error });
    return new Response(JSON.stringify({ ok: false }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
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

/** The single monitor instance — one state machine for the whole app. */
const ALERT_MONITOR_NAME = "dependency-monitor";

/**
 * Read-only view of what the dependency monitor last saw, behind the same
 * publish secret as `/stats`.
 *
 * It exists so the monitor can be inspected without reading Durable Object
 * storage by hand — the deploy smoke test and a human debugging an alert both
 * need "what does it think right now", and neither should be able to change it.
 */
async function handleHealthMonitorState(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("x-realtime-publish-secret") !== env.REALTIME_PUBLISH_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }
  return env.ALERT_MONITOR.get(env.ALERT_MONITOR.idFromName(ALERT_MONITOR_NAME)).fetch(
    "https://alert-monitor/state",
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
