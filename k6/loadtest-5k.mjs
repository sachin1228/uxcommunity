#!/usr/bin/env node
/**
 * 5,000-user SAME-COMMUNITY realtime fan-out load test (audit finding H-3).
 *
 * WHAT IT EXERCISES
 *   N distinct authenticated users, each with its own session JWT, each opening
 *   ONE WebSocket straight to the SAME community Durable Object, each
 *   subscribing to the community chat topic, then a controlled number of REAL
 *   server-side publishes delivered to all of them:
 *
 *     client    → GET /ws?room=chat:<communityId>          (COMMUNITY_DO → Room)
 *     client    → {t:"subscribe", room, topic:"message"}   (Room topic index)
 *     publisher → POST /publish   (server-side path, exactly what
 *                 `publishChatEvent()` in apps/web/lib/realtime/server.ts calls)
 *               → Worker fan-out → Room → broadcastByTopic
 *               → {t:"event", room, topic:"message", data}
 *
 * WHY IT WAS REWRITTEN
 *   The previous revision connected each client to `user:${id}` (that user's
 *   UserDO) and then sent `{t:"subscribe", room:"chat:${COMMUNITY_ID}", topic:"chat"}`.
 *   The server resolves subscriptions from the CONNECTION's room and ignores the
 *   `room` field of a subscribe frame (`Room.webSocketMessage` →
 *   `handleWsSubscribe(ws, msg.topic)`), so those sockets were subscribed inside
 *   5,000 different user rooms. The delivery phase then published to
 *   `chat:${COMMUNITY_ID}` with topic `chat` — a room nobody was in, on a topic
 *   no client subscribes to (the chat topic is `message`). It counted any
 *   `{t:"event"}` frame as a delivery, tracked nothing per event, and defaulted
 *   to PRODUCTION (`wss://rt.uxcommunity.in`). Every number it printed could be
 *   true while zero community fan-out happened.
 *
 * WHAT IT REFUSES TO DO
 *   - Point at production: a host that does not look like staging aborts unless
 *     ALLOW_NON_STAGING=1.
 *   - Reuse one identity across virtual users: every client gets its own user id
 *     and its own JWT (asserted unique before any socket opens).
 *   - Publish thousands of events: the default is 20 events, one per second.
 *   - Publish over client WebSockets: no client `publish` frame is sent, so the
 *     PR #542 topic allow-list (`typing` only) is untouched. Events go through
 *     POST /publish, the secret-authenticated server path.
 *   - Report success it did not observe: the verdict is FAIL when deliveries are
 *     missing, duplicated or arrive for another room/topic.
 *
 * WHAT IT CANNOT MEASURE (stated, not papered over)
 *   - Subscribe ACKs: the wire protocol has none. A socket counts as subscribed
 *     only when the Durable Object reports it (`GET /stats` → `subscriptionRefs`)
 *     or when it is observed receiving this run's event.
 *   - Server-side CPU/memory/time: the Worker exposes no per-event timing.
 *     Delivery latency here is measured client-side from just before the publish
 *     HTTP call to frame parsing, so it is an end-to-end UPPER BOUND.
 *   - Membership enforcement: `Room.checkMembership()` returns early when the
 *     deployment has no `API_URL`. The pre-flight prints which mode it found; the
 *     summary never claims membership was verified.
 *
 * USAGE
 *   SESSION_SECRET=… REALTIME_PUBLISH_SECRET=… TEST_COMMUNITY_ID=<uuid> \
 *     node k6/loadtest-5k.mjs
 *
 *   Ladder — run each stage in order against the same community:
 *     TOTAL_CLIENTS=100  node k6/loadtest-5k.mjs
 *     TOTAL_CLIENTS=500  node k6/loadtest-5k.mjs
 *     TOTAL_CLIENTS=1000 node k6/loadtest-5k.mjs
 *     TOTAL_CLIENTS=2500 node k6/loadtest-5k.mjs
 *     TOTAL_CLIENTS=5000 node k6/loadtest-5k.mjs
 *
 *   Exit code 0 only when the stage passed. JSON_OUT=<path> writes the summary
 *   (k6-style metric names + threshold verdict) for the audit table.
 */

import { writeFileSync } from "node:fs";
import { SignJWT } from "jose";
import WebSocket from "ws";

import {
  DeliveryTracker,
  assertStagingTarget,
  bucketize,
  makeEventId,
  parseEventId,
  parseEventMarker,
  summarizeSamples,
  userIdForIndex,
} from "./lib/realtime-fanout.mjs";

// ── Configuration ────────────────────────────────────────────────────────

const DEFAULT_STAGING_URL = "https://uxcommunity-realtime-staging.patilsachin1228.workers.dev";

const TARGET = (process.env.REALTIME_URL || process.env.WS_BASE_URL || DEFAULT_STAGING_URL)
  .replace(/^wss:/, "https:")
  .replace(/^ws:/, "http:")
  .replace(/\/+$/, "");
const WS_TARGET = TARGET.replace(/^http/, "ws");
const PUBLISH_TARGET = (process.env.PUBLISH_BASE_URL || TARGET).replace(/\/+$/, "");

const SESSION_SECRET = process.env.SESSION_SECRET;
const PUBLISH_SECRET = process.env.REALTIME_PUBLISH_SECRET;
const COMMUNITY_ID = process.env.TEST_COMMUNITY_ID;
const CONTROL_COMMUNITY_ID = process.env.CONTROL_COMMUNITY_ID || "22222222-2222-4222-8222-222222222222";
const TOPIC = process.env.TOPIC || "message";
const ROOM = `chat:${COMMUNITY_ID}`;
const CONTROL_ROOM = `chat:${CONTROL_COMMUNITY_ID}`;

const TOTAL_CLIENTS = Number(process.env.TOTAL_CLIENTS || 5000);
const CONTROL_GROUP_SIZE = Number(process.env.CONTROL_GROUP_SIZE || 0);
const USER_PREFIX = process.env.USER_PREFIX || "h3k6";

const RAMP_BATCH = Number(process.env.RAMP_BATCH || 100);
const RAMP_DELAY_MS = Number(process.env.RAMP_DELAY_MS || 50);
const CONNECT_TIMEOUT_MS = Number(process.env.CONNECT_TIMEOUT_MS || 20000);
const HELLO_TIMEOUT_MS = Number(process.env.HELLO_TIMEOUT_MS || 15000);
const SETTLE_MS = Number(process.env.SETTLE_MS || 8000);
/**
 * After the ramp the room keeps broadcasting presence snapshots (one per
 * ~150ms window while sockets join) and the Durable Object drains that backlog.
 * The publish phase only starts once the room is quiet again, otherwise the
 * fan-out numbers would describe the connect storm instead of a message.
 */
const QUIESCE_TIMEOUT_MS = Number(process.env.QUIESCE_TIMEOUT_MS || 180000);
/** Inbound frames/second tolerated while deciding the room is quiet. */
const QUIESCE_MAX_FRAMES_PER_SECOND = Number(process.env.QUIESCE_MAX_FRAMES_PER_SECOND || 25);
const STRICT_QUIESCE = process.env.STRICT_QUIESCE === "1";
/** Real web clients heartbeat on open sockets; the DO answers without waking. */
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 25000);
const PREFLIGHT_TIMEOUT_MS = Number(process.env.PREFLIGHT_TIMEOUT_MS || 20000);

const EVENT_COUNT = Number(process.env.EVENT_COUNT || 20);
const PUBLISH_INTERVAL_MS = Number(process.env.PUBLISH_INTERVAL_MS || 1000);
const DELIVERY_TIMEOUT_MS = Number(
  process.env.DELIVERY_TIMEOUT_MS || Math.min(180000, 30000 + TOTAL_CLIENTS * 20),
);
const PUBLISH_TIMEOUT_MS = Number(process.env.PUBLISH_TIMEOUT_MS || 15000);
const MIN_CONNECT_RATE = Number(process.env.MIN_CONNECT_RATE || 0.99);
const MIN_DELIVERY_RATE = Number(process.env.MIN_DELIVERY_RATE || 0.99);

/** `server` = POST /publish. `api` = POST /api/communities/:id/messages (needs a full app + DB). */
const PUBLISH_MODE = process.env.PUBLISH_MODE || "server";
const API_BASE_URL = (process.env.API_BASE_URL || "").replace(/\/+$/, "");
const TEST_USER_SESSION_TOKEN = process.env.TEST_USER_SESSION_TOKEN || "";

const JSON_OUT = process.env.JSON_OUT || "";
const TEST_ID = `h3-${Date.now()}`;

/**
 * `same` (the H-3 scenario): every client joins `chat:${TEST_COMMUNITY_ID}`.
 * `distinct`: one community room per client — a CONTROL experiment that
 * separates "this room cannot hold N sockets" from "this harness cannot hold N
 * sockets", because Cloudflare-side limits that are per-room disappear while
 * every client-side and account-level constraint stays identical.
 */
const ROOM_MODE = process.env.ROOM_MODE || "same";

const mainGroupSize = Math.max(0, TOTAL_CLIENTS - CONTROL_GROUP_SIZE);

// ── State ────────────────────────────────────────────────────────────────

/** Assigned in main() before any socket exists (exact per-event accounting). */
let tracker = null;

const phases = { publishing: false, published: false, cleaningUp: false };
const run = { publishDispatchedAt: [], serverDeliverAttempts: null };
const clients = [];

const metrics = {
  connectAttempted: 0,
  connectOpened: 0,
  connectFailed: 0,
  connectFailureReasons: new Map(),
  upgradeRejections: new Map(),
  connectDurations: [],

  helloRequested: 0,
  helloReceived: 0,
  helloTimeouts: 0,
  helloDurations: [],

  subscribeFramesSent: 0,
  subscribeSkipped: 0,
  serverSubscriptionRefs: null,
  serverSocketsAtPublish: null,
  serverTopicsAtPublish: null,

  eventsAttempted: 0,
  eventsPublished: 0,
  publishFailures: 0,
  publishStatuses: new Map(),
  publishRtts: [],
  publishEvents: [],

  unexpectedDisconnects: 0,
  cleanupDisconnects: 0,
  closeCodes: new Map(),
  closeReasons: new Map(),
  disconnectsBeforePublish: 0,
  disconnectsDuringPublish: 0,
  disconnectsAfterPublish: 0,

  beforeStats: null,
  afterConnectStats: null,
  connectPhaseMs: null,
  subscribePhaseMs: null,
  quiesce: null,
  targetRooms: new Set(),
  observedInstances: new Set(),

  wsErrors: 0,
  protocolErrors: 0,
  foreignRoomEvents: 0,
  foreignTopicEvents: 0,
  unmatchedEvents: 0,
  presenceFrames: 0,
  presenceBytes: 0,
  inboundFrames: 0,
  pongs: 0,
};

// ── Small helpers ────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `predicate` (sync or async) until it is truthy or the timeout expires. */
async function waitFor(predicate, timeoutMs, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return true;
    if (Date.now() >= deadline) return false;
    await sleep(intervalMs);
  }
}

function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

function rate(part, total) {
  return total ? `${((part / total) * 100).toFixed(2)}%` : "0%";
}

function formatSummary(summary) {
  if (!summary) return "not measured";
  return `p50=${summary.p50}ms p95=${summary.p95}ms p99=${summary.p99}ms max=${summary.max}ms (n=${summary.count})`;
}

function printProgress(current, total, label) {
  const filled = Math.round((current / Math.max(1, total)) * 30);
  process.stdout.write(
    `\r  ${label}: ${"█".repeat(filled)}${"░".repeat(Math.max(0, 30 - filled))} ${current}/${total}`,
  );
  if (current >= total) process.stdout.write("\n");
}

function requireEnv() {
  const missing = [];
  if (!SESSION_SECRET) missing.push("SESSION_SECRET");
  if (!PUBLISH_SECRET) missing.push("REALTIME_PUBLISH_SECRET");
  if (!COMMUNITY_ID) missing.push("TEST_COMMUNITY_ID");
  if (PUBLISH_MODE === "api") {
    if (!API_BASE_URL) missing.push("API_BASE_URL (required when PUBLISH_MODE=api)");
    if (!TEST_USER_SESSION_TOKEN) missing.push("TEST_USER_SESSION_TOKEN (required when PUBLISH_MODE=api)");
  }
  if (missing.length > 0) {
    console.error(
      `\nERROR: missing required environment variables:\n  - ${missing.join("\n  - ")}\n\n` +
        "  SESSION_SECRET must be the signing secret of the TARGET deployment, otherwise every\n" +
        "  WebSocket upgrade is rejected with 401 before a single message can flow.\n",
    );
    process.exit(2);
  }
}

/** Sign a per-user session JWT the same way the app's login does. */
async function createToken(userId) {
  return new SignJWT({ userId, email: `${userId}@h3loadtest.invalid`, role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("2h")
    .sign(new TextEncoder().encode(SESSION_SECRET));
}

function socketUrl(room, token) {
  return `${WS_TARGET}/ws?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}`;
}

// ── Server calls ─────────────────────────────────────────────────────────

/** Server-side ground truth: the DO's own socket/subscription/fan-out counters. */
async function readServerStats(room) {
  try {
    const response = await fetch(`${PUBLISH_TARGET}/stats?room=${encodeURIComponent(room)}`, {
      headers: { "x-realtime-publish-secret": PUBLISH_SECRET },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { ok: false, status: response.status, body: await response.text() };
    const stats = await response.json();
    // Every instance id seen during the run is kept: a second id means the room
    // was restarted/evicted mid-run, which invalidates the earlier counters and
    // usually explains a batch of sockets dying at once.
    if (stats?.instanceId) metrics.observedInstances.add(stats.instanceId);
    return { ok: true, status: response.status, stats };
  } catch (error) {
    return { ok: false, status: 0, body: String(error?.message ?? error) };
  }
}

/**
 * Payload shaped like the event `publishChatEvent()` sends for a new
 * `community_messages` row. The `h3` block is a test-only annotation the DO
 * passes through opaquely (it never inspects `data`), so receivers can attribute
 * a frame to this run instead of guessing.
 */
function buildServerPublishBody(seq, sentAt) {
  return JSON.stringify({
    room: ROOM,
    topic: TOPIC,
    data: {
      id: makeEventId(TEST_ID, seq),
      community_id: COMMUNITY_ID,
      user_id: userIdForIndex(0, `${USER_PREFIX}publisher`),
      sender_name: "H-3 Load Test",
      sender_avatar_url: null,
      content: `H-3 fanout load test event ${TEST_ID}#${seq}`,
      created_at: new Date(sentAt).toISOString(),
      reply_to_id: null,
      reply_sender_name: null,
      reply_to_content_id: null,
      reply_content_kind: null,
      reply_content_title: null,
      image_url: null,
      mentions: [],
      h3: { test_id: TEST_ID, seq, sent_at: sentAt, target_clients: TOTAL_CLIENTS },
    },
  });
}

async function publishServerSide(seq, sentAt) {
  const response = await fetch(`${PUBLISH_TARGET}/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-realtime-publish-secret": PUBLISH_SECRET,
    },
    body: buildServerPublishBody(seq, sentAt),
    signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
  });
  return { status: response.status, body: (await response.text()).slice(0, 200) };
}

/**
 * The most complete path: create a real message through the app API, which
 * writes the row and then publishes the `message` event. Requires a full
 * staging app + database + a session cookie for a member of the community.
 */
async function publishThroughApi(seq) {
  const response = await fetch(`${API_BASE_URL}/api/communities/${COMMUNITY_ID}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `uxcommunity_session=${TEST_USER_SESSION_TOKEN}`,
    },
    body: JSON.stringify({ content: `H-3 fanout load test event ${TEST_ID}#${seq}` }),
    signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
  });
  return { status: response.status, body: (await response.text()).slice(0, 200) };
}

function publishEvent(seq, sentAt) {
  return PUBLISH_MODE === "api" ? publishThroughApi(seq) : publishServerSide(seq, sentAt);
}

// ── Client model ─────────────────────────────────────────────────────────

class Client {
  constructor(index, isControl, track) {
    this.index = index;
    this.isControl = isControl;
    this.track = track;
    this.room = isControl
      ? CONTROL_ROOM
      : ROOM_MODE === "distinct"
        ? // Control mode keeps client 0 in the target room so one socket can
          // still prove end-to-end delivery; everyone else gets their own room.
          index === 0
          ? ROOM
          : `chat:${COMMUNITY_ID}-${index + 1}`
        : ROOM;
    this.userId = userIdForIndex(index, USER_PREFIX);
    this.token = null;
    this.ws = null;
    this.state = "created";
    this.connectStartedAt = 0;
    this.openedAt = null;
    this.helloAt = null;
    this.subscribeSentAt = null;
    this.closedAt = null;
    this.closeCode = null;
    this.closeReason = "";
    this.receivedAny = false;
    this.receivedFrames = 0;
    this.pongs = 0;
    this.errors = [];
    this.heartbeatTimer = null;
  }

  get isLive() {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }
}

/**
 * Cheap frame classifier: look at a few bytes instead of deserializing the
 * whole payload. A presence snapshot for a 1,000-socket room is ~70 KB and one
 * is sent per socket per flush, so parsing them made the HARNESS the bottleneck
 * (and then the DO's own sends backed up behind a client that could not drain
 * them). Only frames that can carry this run's event are fully parsed.
 */
function frameHead(data) {
  if (typeof data === "string") return data.slice(0, 24);
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return buffer.subarray(0, 24).toString("utf8");
}

function frameLength(data) {
  if (typeof data === "string") return data.length;
  return Buffer.isBuffer(data) ? data.length : (data?.byteLength ?? 0);
}

/** Handle one frame. Attached before `open` so no delivery is ever missed. */
function attachFrameHandler(client, ws) {
  ws.on("message", (data) => {
    if (client.ws !== ws) return;
    metrics.inboundFrames += 1;
    const head = frameHead(data);

    // Heartbeat frames are plain text, not JSON (DO auto-response pair).
    if (head === "pong") {
      client.pongs += 1;
      metrics.pongs += 1;
      return;
    }
    if (head === "ping") return;

    // Presence traffic is not this run's delivery and is never parsed.
    if (head.startsWith('{"t":"presence"')) {
      metrics.presenceFrames += 1;
      metrics.presenceBytes += frameLength(data);
      return;
    }

    if (head.startsWith('{"t":"hello"')) {
      client.helloAt = Date.now();
      if (client.state === "open") client.state = "joined";
      metrics.helloReceived += 1;
      metrics.helloDurations.push(client.helloAt - client.connectStartedAt);
      return;
    }

    let message;
    try {
      message = JSON.parse(typeof data === "string" ? data : data.toString("utf8"));
    } catch {
      metrics.protocolErrors += 1;
      return;
    }

    if (message.t !== "event") return;

    client.receivedFrames += 1;

    // Attribution first: a frame only counts as a delivery of this run's event
    // if it arrived for THIS room, on THIS topic, carrying THIS run's marker.
    if (message.room !== client.room) {
      metrics.foreignRoomEvents += 1;
      return;
    }
    if (message.topic !== TOPIC) {
      metrics.foreignTopicEvents += 1;
      return;
    }

    const seq =
      parseEventId(message.data?.id, TEST_ID) ?? parseEventMarker(message.data?.content, TEST_ID);
    if (seq === null) {
      metrics.unmatchedEvents += 1;
      tracker?.recordUnmatched();
      return;
    }

    const dispatchedAt = run.publishDispatchedAt[seq];
    const latency = typeof dispatchedAt === "number" ? Date.now() - dispatchedAt : Number.NaN;
    const outcome = tracker ? tracker.record(client.index, seq, latency) : null;
    if (outcome === "first") client.receivedAny = true;
  });
}

async function openClient(client) {
  client.connectStartedAt = Date.now();
  metrics.connectAttempted += 1;

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    const timer = setTimeout(() => {
      if (client.openedAt === null) {
        metrics.connectFailed += 1;
        bump(metrics.connectFailureReasons, "connect timeout");
        client.state = "connect-failed";
        try {
          client.ws?.terminate();
        } catch {
          /* already gone */
        }
      }
      finish();
    }, CONNECT_TIMEOUT_MS);

    let ws;
    try {
      ws = new WebSocket(socketUrl(client.room, client.token));
    } catch (error) {
      metrics.connectFailed += 1;
      bump(metrics.connectFailureReasons, error.message);
      finish();
      return;
    }
    client.ws = ws;
    attachFrameHandler(client, ws);

    ws.on("open", () => {
      client.openedAt = Date.now();
      client.state = "open";
      metrics.connectOpened += 1;
      metrics.connectDurations.push(client.openedAt - client.connectStartedAt);
      if (HEARTBEAT_MS > 0) {
        // Staggered so 5,000 sockets do not heartbeat in lockstep.
        client.heartbeatTimer = setInterval(() => {
          if (!client.isLive) return;
          try {
            client.ws.send("ping");
          } catch {
            /* socket already gone */
          }
        }, HEARTBEAT_MS + (client.index % 1000));
      }
      finish();
    });

    ws.on("unexpected-response", (_request, response) => {
      if (client.openedAt === null) {
        metrics.connectFailed += 1;
        bump(metrics.upgradeRejections, String(response.statusCode));
        bump(metrics.connectFailureReasons, `upgrade rejected ${response.statusCode}`);
        client.state = "connect-failed";
      }
      finish();
    });

    ws.on("error", (error) => {
      metrics.wsErrors += 1;
      client.errors.push(error.message);
      if (client.openedAt === null) {
        metrics.connectFailed += 1;
        bump(metrics.connectFailureReasons, error.message || "error");
        client.state = "connect-failed";
      }
      finish();
    });

    ws.on("close", (code, reason) => {
      client.closedAt = Date.now();
      client.closeCode = code;
      client.closeReason = String(reason || "");
      client.state = "closed";
      if (client.heartbeatTimer) clearInterval(client.heartbeatTimer);
      bump(metrics.closeCodes, String(code));
      if (client.closeReason) bump(metrics.closeReasons, client.closeReason);
      if (phases.cleaningUp) {
        metrics.cleanupDisconnects += 1;
      } else {
        metrics.unexpectedDisconnects += 1;
        if (phases.publishing) metrics.disconnectsDuringPublish += 1;
        else if (phases.published) metrics.disconnectsAfterPublish += 1;
        else metrics.disconnectsBeforePublish += 1;
      }
      finish();
    });
  });
}

// ── Pre-flight: prove the whole path once, before spending 5,000 sockets ──

async function preflight() {
  console.log("PRE-FLIGHT");
  console.log("─".repeat(72));
  console.log(`  TARGET ROOM:                ${ROOM}`);
  console.log(`  WebSocket:                  ${WS_TARGET}/ws?room=${ROOM}`);
  console.log(`  Publish:                    ${PUBLISH_MODE === "server" ? `POST ${PUBLISH_TARGET}/publish` : `POST ${API_BASE_URL}/api/communities/${COMMUNITY_ID}/messages`}`);
  console.log(`  Subscribe frame:            {t:"subscribe", room:"${ROOM}", topic:"${TOPIC}"}`);

  const before = await readServerStats(ROOM);
  if (!before.ok) {
    const hint =
      before.status === 404
        ? "\n  The deployed Worker does not expose /stats, so it predates audit PR #537 and is NOT\n  the implementation under test. Redeploy it first."
        : before.status === 403
          ? "\n  REALTIME_PUBLISH_SECRET does not match this deployment."
          : "";
    console.error(`\n  FATAL: GET /stats failed (${before.status} ${before.body}).${hint}\n`);
    process.exit(2);
  }
  const membershipConfigured = (before.stats.metrics?.membershipChecks ?? 0) > 0;
  console.log(`  Server /stats:              OK (instanceId=${before.stats.instanceId ?? "?"})`);
  console.log(
    `  Server before:              sockets=${before.stats.sockets} users=${before.stats.users} ` +
      `subscriptionRefs=${before.stats.subscriptionRefs}`,
  );
  console.log(
    `  Membership gate:            ${membershipConfigured ? "configured (internal membership API in use)" : "NOT enforced by this deployment (no API_URL configured) — recorded as a limitation"}`,
  );

  const probeUserId = userIdForIndex(0, `${USER_PREFIX}probe`);
  const probeToken = await createToken(probeUserId);
  const probe = new WebSocket(socketUrl(ROOM, probeToken));
  const outcome = {
    hello: false,
    event: false,
    upgradeStatus: null,
    error: null,
    publishStatus: null,
    subscribeRegistered: false,
    closeCode: null,
  };

  probe.on("message", (data) => {
    const head = frameHead(data);
    if (head.startsWith('{"t":"hello"')) {
      outcome.hello = true;
      return;
    }
    if (head.startsWith('{"t":"event"')) outcome.event = true;
  });
  probe.on("close", (code) => {
    outcome.closeCode = code;
  });
  probe.on("error", (error) => {
    if (!outcome.error) outcome.error = `socket error: ${error.message}`;
  });

  const upgraded = await Promise.race([
    new Promise((resolve) => probe.once("open", () => resolve(101))),
    new Promise((resolve) => probe.once("unexpected-response", (_request, response) => resolve(response.statusCode))),
    waitFor(() => false, PREFLIGHT_TIMEOUT_MS).then(() => 0),
  ]);
  outcome.upgradeStatus = upgraded;

  if (upgraded === 101) {
    probe.send(JSON.stringify({ t: "join", user: { id: probeUserId, name: "H-3 Probe", avatar: null } }));
    probe.send(JSON.stringify({ t: "subscribe", room: ROOM, topic: TOPIC }));

    await waitFor(() => outcome.hello, HELLO_TIMEOUT_MS);
    // Deterministic: wait until the DO itself reports the subscription, so the
    // publish can never race the subscribe frame.
    outcome.subscribeRegistered = await waitFor(async () => {
      const stats = await readServerStats(ROOM);
      return stats.ok && stats.stats.subscriptionRefs >= 1;
    }, 15000, 250);

    try {
      const result = await publishEvent(0, Date.now());
      outcome.publishStatus = result.status;
      if (result.status !== 200) outcome.error = `publish probe HTTP ${result.status} ${result.body}`;
    } catch (error) {
      outcome.error = `publish probe failed: ${error.message}`;
    }
    await waitFor(() => outcome.event, Math.max(5000, PREFLIGHT_TIMEOUT_MS - 500));
  }

  try {
    probe.close();
  } catch {
    /* already closed */
  }

  const passed = outcome.hello && outcome.event && !outcome.error;
  console.log(
    `  Probe socket:               hello=${outcome.hello} subscriptionRegistered=${outcome.subscribeRegistered} ` +
      `event=${outcome.event} publishStatus=${outcome.publishStatus ?? "-"}` +
      `${outcome.closeCode ? ` closeCode=${outcome.closeCode}` : ""}` +
      `${outcome.error ? ` error=${outcome.error}` : ""}`,
  );
  if (metrics.observedInstances.size > 1) {
    console.log(`  DO instances during pre-flight: ${[...metrics.observedInstances].join(" → ")} (restart visible)`);
  }
  if (!passed) {
    console.error(
      "\n  FATAL: connect → join → subscribe → receive failed on a single socket.\n" +
        "  A 5,000-socket run would only reproduce this failure 5,000 times.\n",
    );
    process.exit(2);
  }

  await sleep(1000);
  const after = await readServerStats(ROOM);
  if (after.ok) {
    console.log(
      `  Server after probe:         sockets=${after.stats.sockets} subscriptionRefs=${after.stats.subscriptionRefs} ` +
        `eventsPublished=${after.stats.metrics?.eventsPublished ?? "?"}`,
    );
  }
  console.log("  Pre-flight:                 PASS — same room, same topic, real server publish, real delivery");
  console.log("");
  metrics.beforeStats = before.stats;
  return { beforeStats: before.stats };
}

// ── Phase 1: connect, join, subscribe ────────────────────────────────────

async function connectClients() {
  const connectStartedAt = Date.now();
  console.log("PHASE 1 — CONNECT + JOIN + SUBSCRIBE");
  console.log("─".repeat(72));
  console.log(`  Requested clients:          ${TOTAL_CLIENTS} distinct authenticated users`);
  console.log(`  Target room:                ${ROOM} (${mainGroupSize} sockets)`);
  if (ROOM_MODE === "distinct") {
    console.log(`  ROOM MODE:                  distinct (control experiment) — one room per client`);
  }
  if (CONTROL_GROUP_SIZE > 0) {
    console.log(`  Cross-room control group:   ${CONTROL_GROUP_SIZE} sockets in ${CONTROL_ROOM}`);
  }
  console.log("");

  for (let batchStart = 0; batchStart < TOTAL_CLIENTS; batchStart += RAMP_BATCH) {
    const batchEnd = Math.min(batchStart + RAMP_BATCH, TOTAL_CLIENTS);
    const openings = [];

    for (let index = batchStart; index < batchEnd; index += 1) {
      const client = new Client(index, index >= mainGroupSize, tracker);
      client.token = await createToken(client.userId);
      clients[index] = client;
      openings.push(openClient(client));
    }

    await Promise.all(openings);
    printProgress(metrics.connectOpened + metrics.connectFailed, TOTAL_CLIENTS, "connecting");
    if (batchEnd < TOTAL_CLIENTS) await sleep(RAMP_DELAY_MS);
  }
  console.log("");
  metrics.connectPhaseMs = Date.now() - connectStartedAt;
  const subscribeStartedAt = Date.now();

  // Every socket joins as its own identity; the DO answers `hello`.
  for (const client of clients) {
    if (!client.isLive) continue;
    metrics.helloRequested += 1;
    client.ws.send(
      JSON.stringify({ t: "join", user: { id: client.userId, name: `H3 ${client.index}`, avatar: null } }),
    );
  }
  const helloDeadline = Date.now() + HELLO_TIMEOUT_MS;
  while (Date.now() < helloDeadline && metrics.helloReceived < metrics.helloRequested) {
    await sleep(100);
  }
  for (const client of clients) {
    if (client.helloAt === null && client.isLive) metrics.helloTimeouts += 1;
  }

  // Subscribe to the community topic. The DO resolves a subscription from the
  // CONNECTION's room and ignores the frame's `room` field — this is exactly why
  // the socket had to be opened against `chat:${COMMUNITY_ID}`.
  for (const client of clients) {
    if (!client.isLive) {
      metrics.subscribeSkipped += 1;
      continue;
    }
    client.ws.send(JSON.stringify({ t: "subscribe", room: client.room, topic: TOPIC }));
    client.subscribeSentAt = Date.now();
    client.state = "subscribed";
    metrics.subscribeFramesSent += 1;
    metrics.targetRooms.add(client.room);
  }
  metrics.subscribePhaseMs = Date.now() - subscribeStartedAt;

  console.log(`  Connected:                  ${metrics.connectOpened}/${TOTAL_CLIENTS} (${rate(metrics.connectOpened, TOTAL_CLIENTS)})`);
  console.log(`  Failed:                     ${metrics.connectFailed}`);
  if (metrics.connectFailureReasons.size > 0) {
    console.log(`  Failure reasons:            ${JSON.stringify(Object.fromEntries(metrics.connectFailureReasons))}`);
  }
  if (metrics.upgradeRejections.size > 0) {
    console.log(`  Upgrade HTTP statuses:      ${JSON.stringify(Object.fromEntries(metrics.upgradeRejections))}`);
  }
  console.log(`  Connection time:            ${formatSummary(summarizeSamples(metrics.connectDurations))}`);
  console.log(`  hello received:             ${metrics.helloReceived}/${metrics.helloRequested}`);
  console.log(`  Subscribe frames sent:      ${metrics.subscribeFramesSent} (topic "${TOPIC}")`);
  console.log("  Waiting for the Durable Object's own subscriber count to settle…");

  // /stats is the only "subscription success" signal the protocol offers. The
  // count is read twice and only accepted once it stops moving: a single read
  // can land while the last subscribe frame is still in flight and under-report
  // by one, which would look like a missing subscription in the report.
  const settleDeadline = Date.now() + SETTLE_MS;
  // In `same` mode this equals the main group; in the `distinct` control only
  // the sockets actually in ROOM can register there.
  const expectedRefs = liveTargetReceivers();
  let stats = null;
  let previousRefs = -1;
  while (Date.now() < settleDeadline) {
    stats = await readServerStats(ROOM);
    const refs = stats.ok ? stats.stats.subscriptionRefs : null;
    if (refs !== null && refs === previousRefs && refs >= expectedRefs * MIN_CONNECT_RATE) break;
    previousRefs = refs === null ? -1 : refs;
    await sleep(500);
  }

  const liveMain = clients.filter((client) => !client.isControl && client.isLive).length;
  if (stats?.ok) {
    metrics.serverSubscriptionRefs = stats.stats.subscriptionRefs;
    metrics.serverSocketsAtPublish = stats.stats.sockets;
    metrics.serverTopicsAtPublish = stats.stats.topics;
    console.log(
      `  Server /stats:              sockets=${stats.stats.sockets} users=${stats.stats.users} ` +
        `topics=${stats.stats.topics} subscriptionRefs=${stats.stats.subscriptionRefs}`,
    );
  } else {
    console.log(`  Server /stats:              unavailable (${stats?.status ?? "?"} ${stats?.body ?? ""})`);
  }

  if (!stats?.ok || stats.stats.subscriptionRefs < expectedRefs * MIN_CONNECT_RATE) {
    console.error(
      `\n  FATAL: the Durable Object reports ${metrics.serverSubscriptionRefs ?? 0} subscription(s) for ` +
        `${expectedRefs} live socket(s) in ${ROOM} (${liveMain} live in the main group).\n` +
        "  Those sockets are not actually subscribed to the target room/topic, so the run would measure\n" +
        "  nothing — the exact failure the old script could not detect. Aborting before publishing.\n",
    );
    process.exit(1);
  }

  metrics.afterConnectStats = stats.stats;
  await waitForQuiescence();
  console.log("");
  return clients;
}

/**
 * Wait until the room stops broadcasting before publishing anything.
 *
 * Every socket that connects marks the presence roster dirty, and the DO flushes
 * a snapshot to every socket in the room per ~150ms window (`flushPresence()`),
 * so a 1,000-socket ramp leaves a large backlog of presence frames queued for
 * delivery. Publishing into that backlog measures the connect storm, not message
 * fan-out — this waits for the DO's own counters and the inbound frame rate to
 * settle, and reports how long that took and how much presence traffic it cost.
 */
async function waitForQuiescence() {
  console.log("  Waiting for the room to quiesce (presence backlog from the ramp)…");
  const windowStartFrames = metrics.inboundFrames;
  const startedAt = Date.now();
  const deadline = startedAt + QUIESCE_TIMEOUT_MS;

  let previousBusy = null;
  let stableReads = 0;
  let lastFrames = windowStartFrames;
  let lastStats = null;

  while (Date.now() < deadline) {
    await sleep(1000);
    lastStats = await readServerStats(ROOM);
    const framesThisSecond = metrics.inboundFrames - lastFrames;
    lastFrames = metrics.inboundFrames;
    if (!lastStats.ok) continue;

    const busy =
      (lastStats.stats.metrics.presenceDeliverAttempts ?? 0) +
      (lastStats.stats.metrics.deliverAttempts ?? 0);
    if (
      previousBusy !== null &&
      busy === previousBusy &&
      framesThisSecond <= QUIESCE_MAX_FRAMES_PER_SECOND
    ) {
      stableReads += 1;
    } else {
      stableReads = 0;
    }
    previousBusy = busy;

    if (stableReads >= 2) {
      const quiet = lastStats.stats;
      const connect = metrics.afterConnectStats;
      metrics.quiesce = {
        quiesced: true,
        waitedMs: Date.now() - startedAt,
        presenceBroadcastsDuringRamp: (connect?.metrics.presenceBroadcasts ?? 0) - (metrics.beforeStats?.metrics?.presenceBroadcasts ?? 0),
        presenceDeliveriesDuringRamp: (connect?.metrics.presenceDeliverAttempts ?? 0) - (metrics.beforeStats?.metrics?.presenceDeliverAttempts ?? 0),
        presenceBroadcastsTotal: quiet.metrics.presenceBroadcasts,
        presenceDeliveriesTotal: quiet.metrics.presenceDeliverAttempts,
        presenceFramesReceived: metrics.presenceFrames,
        presenceBytesReceived: metrics.presenceBytes,
        inboundFrames: metrics.inboundFrames,
      };
      console.log(
        `  Room quiesced after ${metrics.quiesce.waitedMs}ms. Presence cost of the ${mainGroupSize}-socket ramp: ` +
          `${metrics.quiesce.presenceBroadcastsDuringRamp} snapshot broadcast(s), ` +
          `${metrics.quiesce.presenceDeliveriesDuringRamp} socket send(s) — received here: ` +
          `${metrics.presenceFrames} frame(s) / ${(metrics.presenceBytes / 1e6).toFixed(1)} MB.`,
      );
      return;
    }
  }

  metrics.quiesce = {
    quiesced: false,
    waitedMs: Date.now() - startedAt,
    presenceFramesReceived: metrics.presenceFrames,
    presenceBytesReceived: metrics.presenceBytes,
    inboundFrames: metrics.inboundFrames,
    lastStats: lastStats?.ok ? lastStats.stats.metrics : null,
  };
  const message =
    `the room did not quiesce within ${QUIESCE_TIMEOUT_MS}ms — presence traffic is still draining. ` +
    "Publishing now would measure the connect storm, not message fan-out.";
  if (STRICT_QUIESCE) {
    console.error(`\n  FATAL: ${message}\n`);
    process.exit(1);
  }
  console.log(`  WARNING: ${message}`);
  console.log("  Continuing (set STRICT_QUIESCE=1 to treat this as fatal). The per-event numbers will show it.");
}

// ── Phase 2: controlled server-side publishes ────────────────────────────

/** Live main-group sockets whose room is the target room (all of them in `same` mode). */
function liveTargetReceivers() {
  return clients.filter((client) => !client.isControl && client.isLive && client.room === ROOM).length;
}

async function publishEvents() {
  const expectedInitial = liveTargetReceivers();

  console.log("PHASE 2 — CONTROLLED SERVER-SIDE PUBLISHES + DELIVERY");
  console.log("─".repeat(72));
  console.log(`  Events:                     ${EVENT_COUNT} × topic "${TOPIC}" → ${ROOM}`);
  console.log(`  Publish path:               ${PUBLISH_MODE === "server" ? `POST ${PUBLISH_TARGET}/publish` : `POST ${API_BASE_URL}/api/communities/${COMMUNITY_ID}/messages`}`);
  console.log(`  Rate:                       one event every ${PUBLISH_INTERVAL_MS}ms (no burst)`);
  console.log(`  Expected initial receivers: ${expectedInitial}`);
  console.log("");

  phases.publishing = true;
  const beforeFirstPublish = await readServerStats(ROOM);
  run.serverDeliverAttempts = beforeFirstPublish.ok ? beforeFirstPublish.stats.metrics.deliverAttempts : null;

  for (let seq = 0; seq < EVENT_COUNT; seq += 1) {
    await sleep(PUBLISH_INTERVAL_MS);

    const expectedLive = liveTargetReceivers();
    const sentAt = Date.now();
    run.publishDispatchedAt[seq] = sentAt;
    metrics.eventsAttempted += 1;

    const publishStartedAt = Date.now();
    let result;
    try {
      result = await publishEvent(seq, sentAt);
    } catch (error) {
      result = { status: 0, body: String(error?.message ?? error) };
    }
    metrics.publishRtts.push(Date.now() - publishStartedAt);
    bump(metrics.publishStatuses, String(result.status));
    if (result.status === 200) {
      metrics.eventsPublished += 1;
    } else {
      metrics.publishFailures += 1;
    }

    // Wait for this run's deliveries of this event. Exact, not sampled.
    const deadline = Date.now() + DELIVERY_TIMEOUT_MS;
    while (tracker.receivedFor(seq) < expectedLive && Date.now() < deadline) {
      await sleep(expectedLive > 1000 ? 100 : 25);
    }
    const received = tracker.receivedFor(seq);

    // Cross-check against the DO's own send counter for this event.
    const statsAfter = await readServerStats(ROOM);
    let serverDelta = null;
    if (statsAfter.ok) {
      const attempts = statsAfter.stats.metrics.deliverAttempts;
      serverDelta = run.serverDeliverAttempts === null ? null : attempts - run.serverDeliverAttempts;
      run.serverDeliverAttempts = attempts;
    }

    metrics.publishEvents.push({
      seq,
      publishStatus: result.status,
      publishRttMs: Date.now() - publishStartedAt,
      expectedInitial,
      expectedLive,
      received,
      missingVsInitial: Math.max(0, expectedInitial - received),
      duplicates: tracker.duplicatesFor(seq),
      waitMs: Date.now() - sentAt,
      fanoutSpanMs: tracker.fanoutSpanFor(seq),
      latency: summarizeSamples(tracker.latenciesFor(seq)),
      serverDeliverDelta: serverDelta,
    });

    const event = metrics.publishEvents[metrics.publishEvents.length - 1];
    console.log(
      `  event ${String(seq).padStart(3)}: http=${event.publishStatus} rtt=${event.publishRttMs}ms ` +
        `delivered=${event.received}/${event.expectedInitial} (live ${event.expectedLive}) ` +
        `missing=${event.missingVsInitial} dups=${event.duplicates} wait=${event.waitMs}ms ` +
        `fanoutSpan=${event.fanoutSpanMs ?? "n/a"}ms serverDeliverΔ=${event.serverDeliverDelta ?? "n/a"}`,
    );
  }

  phases.publishing = false;
  phases.published = true;
  console.log("");
}

// ── Summary + verdict ────────────────────────────────────────────────────

function buildSummary({ beforeStats, afterStats, durationSec }) {
  const deliveries = metrics.publishEvents.reduce((sum, event) => sum + event.received, 0);
  const expected = metrics.publishEvents.reduce((sum, event) => sum + event.expectedInitial, 0);
  const expectedLive = metrics.publishEvents.reduce((sum, event) => sum + event.expectedLive, 0);
  const missing = metrics.publishEvents.reduce((sum, event) => sum + event.missingVsInitial, 0);
  const latencies = tracker.allLatencies();

  return {
    test_id: TEST_ID,
    environment: {
      target: TARGET,
      publish_target: PUBLISH_TARGET,
      room: ROOM,
      community_id: COMMUNITY_ID,
      topic: TOPIC,
      publish_mode: PUBLISH_MODE,
      control_room: CONTROL_GROUP_SIZE > 0 ? CONTROL_ROOM : null,
    },
    configuration: {
      requested_clients: TOTAL_CLIENTS,
      main_group_clients: mainGroupSize,
      control_group_clients: CONTROL_GROUP_SIZE,
      events: EVENT_COUNT,
      publish_interval_ms: PUBLISH_INTERVAL_MS,
      min_connect_rate: MIN_CONNECT_RATE,
      min_delivery_rate: MIN_DELIVERY_RATE,
      duration_sec: durationSec,
    },
    metrics: {
      // k6-style metric names + threshold semantics, emitted by a Node runner.
      h3_connections_attempted: metrics.connectAttempted,
      h3_connections_opened: metrics.connectOpened,
      h3_connections_failed: metrics.connectFailed,
      h3_connection_rate: Number(
        (metrics.connectOpened / Math.max(1, metrics.connectAttempted)).toFixed(4),
      ),
      h3_connect_duration_ms: summarizeSamples(metrics.connectDurations),
      h3_hello_received: metrics.helloReceived,
      h3_hello_timeouts: metrics.helloTimeouts,
      h3_hello_duration_ms: summarizeSamples(metrics.helloDurations),
      h3_subscribe_frames_sent: metrics.subscribeFramesSent,
      h3_subscribe_frames_skipped: metrics.subscribeSkipped,
      h3_subscriptions_server_reported: metrics.serverSubscriptionRefs,
      h3_server_sockets_at_publish: metrics.serverSocketsAtPublish,
      h3_server_topics_at_publish: metrics.serverTopicsAtPublish,
      h3_receiving_sockets: tracker.receivers,
      h3_receiving_sockets_live_at_first_publish: metrics.publishEvents[0]?.expectedInitial ?? null,
      h3_events_attempted: metrics.eventsAttempted,
      h3_events_published: metrics.eventsPublished,
      h3_publish_failures: metrics.publishFailures,
      h3_publish_statuses: Object.fromEntries(metrics.publishStatuses),
      h3_publish_rtt_ms: summarizeSamples(metrics.publishRtts),
      h3_expected_deliveries: expected,
      h3_actual_deliveries: deliveries,
      h3_delivery_rate: expected ? Number((deliveries / expected).toFixed(4)) : 0,
      h3_expected_deliveries_live: expectedLive,
      h3_delivery_rate_live: expectedLive ? Number((deliveries / expectedLive).toFixed(4)) : 0,
      h3_missing_deliveries: missing,
      h3_duplicate_deliveries: tracker.totalDuplicates,
      h3_unmatched_event_frames: tracker.unmatchedFrames,
      h3_foreign_room_events: metrics.foreignRoomEvents,
      h3_foreign_topic_events: metrics.foreignTopicEvents,
      h3_delivery_latency_ms: summarizeSamples(latencies),
      h3_delivery_latency_buckets: bucketize(latencies),
      h3_ws_errors: metrics.wsErrors,
      h3_protocol_errors: metrics.protocolErrors,
      h3_unexpected_disconnects: metrics.unexpectedDisconnects,
      h3_close_codes: Object.fromEntries(metrics.closeCodes),
      h3_close_reasons: Object.fromEntries(metrics.closeReasons),
      h3_presence_frames_ignored: metrics.presenceFrames,
      h3_presence_bytes_ignored: metrics.presenceBytes,
      h3_inbound_frames_total: metrics.inboundFrames,
      h3_quiesce: metrics.quiesce,
      h3_pongs_received: metrics.pongs,
      h3_target_rooms: metrics.targetRooms.size,
      h3_room_mode: ROOM_MODE,
      h3_do_instances_observed: [...metrics.observedInstances],
      h3_phase_durations_ms: {
        connect: metrics.connectPhaseMs,
        subscribe: metrics.subscribePhaseMs,
        quiesce: metrics.quiesce?.waitedMs ?? null,
        total: durationSec * 1000,
      },
      h3_server_before: beforeStats
        ? { sockets: beforeStats.sockets, subscriptionRefs: beforeStats.subscriptionRefs }
        : null,
      h3_server_after: afterStats
        ? {
            instanceId: afterStats.instanceId,
            sockets: afterStats.sockets,
            users: afterStats.users,
            topics: afterStats.topics,
            subscriptionRefs: afterStats.subscriptionRefs,
            metrics: afterStats.metrics,
          }
        : null,
    },
    per_event: metrics.publishEvents,
    verdict: null,
  };
}

function evaluate(summary) {
  const reasons = [];
  const m = summary.metrics;
  const expectedInitial = metrics.publishEvents[0]?.expectedInitial ?? mainGroupSize;

  if (m.h3_connection_rate < MIN_CONNECT_RATE) {
    reasons.push(
      `only ${m.h3_connections_opened}/${m.h3_connections_attempted} sockets connected (need ${MIN_CONNECT_RATE * 100}%)`,
    );
  }
  if (m.h3_subscriptions_server_reported === null) {
    reasons.push("the Durable Object never reported a subscriber count");
  } else if (m.h3_subscriptions_server_reported < expectedInitial * MIN_CONNECT_RATE) {
    reasons.push(
      `DO reported ${m.h3_subscriptions_server_reported} subscriptions for ${expectedInitial} sockets (need ${MIN_CONNECT_RATE * 100}%)`,
    );
  }
  if (m.h3_events_published !== m.h3_events_attempted) {
    reasons.push(`${m.h3_events_attempted - m.h3_events_published} publish request(s) were not HTTP 200`);
  }
  if (m.h3_delivery_rate < MIN_DELIVERY_RATE) {
    reasons.push(`delivery rate ${(m.h3_delivery_rate * 100).toFixed(2)}% < ${MIN_DELIVERY_RATE * 100}%`);
  }
  if (m.h3_duplicate_deliveries > 0) reasons.push(`${m.h3_duplicate_deliveries} duplicate delivery/deliveries`);
  if (m.h3_foreign_room_events > 0) reasons.push(`${m.h3_foreign_room_events} event(s) arrived for another room`);
  if (m.h3_foreign_topic_events > 0) reasons.push(`${m.h3_foreign_topic_events} event(s) arrived on another topic`);

  const warnings = [];
  if (ROOM_MODE === "same" && metrics.observedInstances.size > 1) {
    warnings.push(
      `the room DO was (re)started during this run — instances observed: ${[...metrics.observedInstances].join(", ")}. ` +
        "Counters and socket state collected before the restart describe the dead instance.",
    );
    reasons.push(`the room DO restarted mid-run (${[...metrics.observedInstances].join(" → ")})`);
  }
  if (metrics.quiesce && !metrics.quiesce.quiesced) {
    warnings.push(
      "the room was still draining presence traffic when publishing started, so the latency figures include that backlog",
    );
  }
  if (metrics.presenceBytes > 200e6) {
    warnings.push(
      `the harness received ${(metrics.presenceBytes / 1e6).toFixed(0)} MB of presence snapshots during the ramp — the room's presence cost dominates this stage`,
    );
  }

  return { passed: reasons.length === 0, reasons, warnings };
}

function printReport(summary, verdict) {
  const m = summary.metrics;
  const line = "═".repeat(72);
  console.log(line);
  console.log(`  H-3 SAME-COMMUNITY REALTIME FAN-OUT — ${TOTAL_CLIENTS} CLIENTS`);
  console.log(line);
  console.log("");
  console.log("Environment");
  console.log("-----------");
  console.log(`  Target:                 ${TARGET}`);
  console.log(`  TARGET ROOM:            ${ROOM}`);
  console.log(`  Community:              ${COMMUNITY_ID}`);
  console.log(`  Topic:                  ${TOPIC}`);
  console.log(`  Publish mode:           ${PUBLISH_MODE}`);
  console.log(`  Test id:                ${TEST_ID}`);
  console.log(`  Duration:               ${summary.configuration.duration_sec}s (connect ${Math.round((m.h3_phase_durations_ms.connect ?? 0) / 1000)}s, quiesce ${Math.round((m.h3_phase_durations_ms.quiesce ?? 0) / 1000)}s)`);
  console.log(`  Rooms targeted:         ${m.h3_target_rooms} (mode: ${m.h3_room_mode})`);
  console.log(`  DO instances observed:  ${m.h3_do_instances_observed.join(", ")}${m.h3_do_instances_observed.length > 1 ? "  ← RESTART during the run" : ""}`);
  console.log("");
  console.log("Connections");
  console.log("-----------");
  console.log(`  Attempted:              ${m.h3_connections_attempted}`);
  console.log(`  Opened:                 ${m.h3_connections_opened} (${rate(m.h3_connections_opened, m.h3_connections_attempted)})`);
  console.log(`  Failed:                 ${m.h3_connections_failed}`);
  if (metrics.connectFailureReasons.size > 0) {
    console.log(`  Failure reasons:        ${JSON.stringify(Object.fromEntries(metrics.connectFailureReasons))}`);
  }
  if (metrics.upgradeRejections.size > 0) {
    console.log(`  Upgrade rejections:     ${JSON.stringify(Object.fromEntries(metrics.upgradeRejections))}`);
  }
  console.log(`  Connection time:        ${formatSummary(m.h3_connect_duration_ms)}`);
  console.log(`  hello received:         ${m.h3_hello_received}/${metrics.helloRequested}`);
  console.log("");
  console.log("Subscriptions");
  console.log("-------------");
  console.log(`  Subscribe frames sent:  ${m.h3_subscribe_frames_sent} (topic "${TOPIC}")`);
  console.log(`  DO-reported subscribers:${String(m.h3_subscriptions_server_reported).padStart(7)}   ← /stats, server-side ground truth`);
  console.log(`  DO-reported sockets:    ${String(m.h3_server_sockets_at_publish).padStart(7)}`);
  console.log(`  Sockets that received:  ${String(m.h3_receiving_sockets).padStart(7)}   ← delivery is the only real proof of a subscription`);
  console.log("  (the wire protocol has no subscribe ACK — see the audit doc's limitations)");
  console.log("");
  console.log("Fan-out");
  console.log("-------");
  console.log(`  Events published:       ${m.h3_events_published}/${m.h3_events_attempted} (HTTP 200)`);
  console.log(`  Expected deliveries:    ${m.h3_expected_deliveries}`);
  console.log(`  Actual deliveries:      ${m.h3_actual_deliveries}`);
  console.log(`  Delivery rate:          ${rate(m.h3_actual_deliveries, m.h3_expected_deliveries)}`);
  console.log(`  Missing deliveries:     ${m.h3_missing_deliveries}`);
  console.log(`  Duplicate deliveries:   ${m.h3_duplicate_deliveries}`);
  console.log(`  Unmatched event frames: ${m.h3_unmatched_event_frames}`);
  console.log(`  Other-room events:      ${m.h3_foreign_room_events}`);
  console.log(`  Other-topic events:     ${m.h3_foreign_topic_events}`);
  console.log("");
  console.log("Delivery latency (client-measured: publish dispatch → frame parsed)");
  console.log("-------------------------------------------------------------------");
  if (m.h3_delivery_latency_ms) {
    console.log(
      `  p50=${m.h3_delivery_latency_ms.p50}ms  p90=${m.h3_delivery_latency_ms.p90}ms  ` +
        `p95=${m.h3_delivery_latency_ms.p95}ms  p99=${m.h3_delivery_latency_ms.p99}ms`,
    );
    console.log(
      `  min=${m.h3_delivery_latency_ms.min}ms  max=${m.h3_delivery_latency_ms.max}ms  ` +
        `mean=${m.h3_delivery_latency_ms.mean}ms  n=${m.h3_delivery_latency_ms.count}`,
    );
    for (const bucket of m.h3_delivery_latency_buckets) {
      console.log(`  ${bucket.label.padEnd(8)} ${bucket.count}`);
    }
    console.log("  Upper bound: it includes the publisher's HTTP round trip. The Worker exposes no");
    console.log("  per-event server-side timing to compare against.");
  } else {
    console.log("  Not measured (no deliveries recorded).");
  }
  console.log("");
  console.log("Runtime errors");
  console.log("--------------");
  console.log(`  WebSocket errors:       ${m.h3_ws_errors}`);
  console.log(`  Non-JSON frames:        ${m.h3_protocol_errors}`);
  console.log(
    `  Unexpected disconnects: ${m.h3_unexpected_disconnects} ` +
      `(before publish ${metrics.disconnectsBeforePublish}, during ${metrics.disconnectsDuringPublish}, after ${metrics.disconnectsAfterPublish})`,
  );
  console.log(`  Publish failures:       ${m.h3_publish_failures}`);
  if (metrics.closeCodes.size > 0) {
    console.log(`  Close codes:            ${JSON.stringify(Object.fromEntries(metrics.closeCodes))}`);
  }
  if (metrics.closeReasons.size > 0) {
    console.log(`  Close reasons:          ${JSON.stringify(Object.fromEntries(metrics.closeReasons))}`);
  }
  console.log(`  Presence frames ignored:${String(m.h3_presence_frames_ignored).padStart(6)} (${(m.h3_presence_bytes_ignored / 1e6).toFixed(1)} MB, never parsed)`);
  console.log(`  Heartbeat pongs:        ${m.h3_pongs_received}`);
  if (m.h3_quiesce) {
    console.log(
      `  Quiesce:                ${m.h3_quiesce.quiesced ? `settled after ${m.h3_quiesce.waitedMs}ms` : `NOT settled within ${QUIESCE_TIMEOUT_MS}ms`}` +
        `${m.h3_quiesce.presenceBroadcastsDuringRamp !== undefined ? ` | ramp presence: ${m.h3_quiesce.presenceBroadcastsDuringRamp} broadcast(s) / ${m.h3_quiesce.presenceDeliveriesDuringRamp} send(s)` : ""}`,
    );
  }
  console.log("");
  console.log("Per-event delivery (exact counts, one bitmap row per socket)");
  console.log("-----------------------------------------------------------");
  console.log("  seq  http  rtt(ms)  delivered/expected  missing  dups  wait(ms)  fanoutSpan(ms)  serverDeliverΔ");
  for (const event of metrics.publishEvents) {
    console.log(
      `  ${String(event.seq).padStart(3)}  ${String(event.publishStatus).padStart(4)}  ${String(event.publishRttMs).padStart(7)}  ` +
        `${String(event.received).padStart(9)}/${String(event.expectedInitial).padEnd(8)}  ${String(event.missingVsInitial).padStart(7)}  ` +
        `${String(event.duplicates).padStart(4)}  ${String(event.waitMs).padStart(8)}  ` +
        `${String(event.fanoutSpanMs ?? "n/a").padStart(14)}  ${String(event.serverDeliverDelta ?? "n/a").padStart(14)}`,
    );
  }
  console.log("");
  console.log("Durable Object counters (GET /stats)");
  console.log("------------------------------------");
  if (m.h3_server_after) {
    console.log(`  instanceId:             ${m.h3_server_after.instanceId}`);
    for (const [key, value] of Object.entries(m.h3_server_after.metrics)) {
      console.log(`  ${key.padEnd(23)} ${value}`);
    }
    console.log(`  sockets after cleanup:  ${m.h3_server_after.sockets} (expected 0)`);
  } else {
    console.log("  unavailable");
  }
  console.log("");
  console.log("VERDICT");
  console.log("-------");
  console.log(verdict.passed ? "  PASS — every measured threshold met" : "  FAIL");
  for (const reason of verdict.reasons) console.log(`    - ${reason}`);
  if (verdict.warnings?.length) {
    console.log(verdict.passed ? "  WARNINGS (result still claims only what was measured):" : "  Also:");
    for (const warning of verdict.warnings) console.log(`    ! ${warning}`);
  }
  console.log("");
  console.log(
    `  Claim under test: ${m.h3_connections_opened} authenticated users connected to ${ROOM} in one\n` +
      `  Community Room Durable Object, ${m.h3_subscriptions_server_reported ?? "?"} subscribed to topic "${TOPIC}",\n` +
      `  and ${m.h3_actual_deliveries}/${m.h3_expected_deliveries} controlled server-published events were delivered.`,
  );
  console.log("");
  console.log("  NOT verified here: production membership enforcement, server-side CPU per event,");
  console.log("  and latency excluding the publish round trip. See docs/realtime-5k-loadtest-audit.md.");
  console.log(line);
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  requireEnv();

  const target = assertStagingTarget(TARGET, { allowNonStaging: process.env.ALLOW_NON_STAGING === "1" });
  if (!target.ok) {
    console.error(`\nERROR: ${target.reason}\n`);
    process.exit(2);
  }
  if (!Number.isInteger(TOTAL_CLIENTS) || TOTAL_CLIENTS <= 0) {
    console.error(`\nERROR: TOTAL_CLIENTS must be a positive integer (got ${process.env.TOTAL_CLIENTS}).\n`);
    process.exit(2);
  }
  if (CONTROL_GROUP_SIZE < 0 || CONTROL_GROUP_SIZE >= TOTAL_CLIENTS) {
    console.error("\nERROR: CONTROL_GROUP_SIZE must be >= 0 and smaller than TOTAL_CLIENTS.\n");
    process.exit(2);
  }
  if (EVENT_COUNT <= 0) {
    console.error("\nERROR: EVENT_COUNT must be a positive integer.\n");
    process.exit(2);
  }

  // 5,000 distinct identities — never one shared JWT across virtual users.
  const identities = new Set();
  for (let index = 0; index < TOTAL_CLIENTS; index += 1) identities.add(userIdForIndex(index, USER_PREFIX));
  if (identities.size !== TOTAL_CLIENTS) {
    console.error("\nERROR: generated user ids are not distinct — refusing to run with a shared identity.\n");
    process.exit(2);
  }

  tracker = new DeliveryTracker({ eventCount: EVENT_COUNT, capacity: TOTAL_CLIENTS });

  const startedAt = Date.now();
  console.log("═".repeat(72));
  console.log("  H-3 — 5K SAME-COMMUNITY REALTIME FAN-OUT LOAD TEST");
  console.log("═".repeat(72));
  console.log(`  TARGET ROOM:        ${ROOM}`);
  console.log(`  Target:             ${TARGET}`);
  console.log(`  Clients:            ${TOTAL_CLIENTS} distinct authenticated users`);
  console.log(`  Events:             ${EVENT_COUNT} × topic "${TOPIC}" every ${PUBLISH_INTERVAL_MS}ms`);
  console.log(`  Test id:            ${TEST_ID}`);
  console.log(`  Started:            ${new Date(startedAt).toISOString()}`);
  console.log("");

  const { beforeStats } = await preflight();

  // Instance ids are only tracked from here on: a second id now means the room
  // restarted DURING this run, not that it went idle between runs.
  metrics.observedInstances.clear();
  await connectClients();
  await publishEvents();

  console.log("CLEANUP");
  console.log("─".repeat(72));
  phases.cleaningUp = true;
  let closed = 0;
  for (const client of clients) {
    if (client.heartbeatTimer) clearInterval(client.heartbeatTimer);
    if (client.ws && (client.isLive || client.ws.readyState === WebSocket.CONNECTING)) {
      try {
        client.ws.close(1000, "h3 load test complete");
        closed += 1;
      } catch {
        /* already gone */
      }
    }
  }
  await sleep(4000);
  const afterStats = await readServerStats(ROOM);
  console.log(`  Sockets closed:         ${closed}`);
  console.log(`  Unexpected disconnects: ${metrics.unexpectedDisconnects}`);
  if (afterStats.ok) {
    console.log(
      `  ${ROOM} after close:  sockets=${afterStats.stats.sockets} subscriptionRefs=${afterStats.stats.subscriptionRefs} (both expected 0)`,
    );
  }

  const summary = buildSummary({
    beforeStats,
    afterStats: afterStats.ok ? afterStats.stats : null,
    durationSec: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
  });
  const verdict = evaluate(summary);
  summary.verdict = verdict;

  printReport(summary, verdict);

  if (JSON_OUT) {
    writeFileSync(JSON_OUT, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(`\n  JSON summary: ${JSON_OUT}`);
  }
  console.log(`  Finished: ${new Date().toISOString()}`);

  // Sockets are already closed; nothing should keep the process alive.
  process.exit(verdict.passed ? 0 : 1);
}

main().catch((error) => {
  console.error("\nFATAL:", error);
  process.exit(1);
});
