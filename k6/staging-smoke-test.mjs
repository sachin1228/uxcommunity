#!/usr/bin/env node
/**
 * One-socket smoke test for the staging realtime worker.
 *
 * Proves the end-to-end path the app actually uses, once, before anyone runs a
 * large test against the same room:
 *
 *   connect to chat:${COMMUNITY_ID}   (COMMUNITY_DO → Room, JWT in ?token=)
 *   join {t:"join", user}             → server answers {t:"hello"}
 *   subscribe {t:"subscribe", room, topic:"message"}
 *   publish POST /publish             (server-side path, as the app does)
 *   receive {t:"event", room, topic:"message"}
 *
 * It also reads the room's own counters (`GET /stats`) so "subscribed" is
 * confirmed by the Durable Object, not assumed.
 *
 *   SESSION_SECRET=… REALTIME_PUBLISH_SECRET=… TEST_COMMUNITY_ID=<uuid> \
 *     node k6/staging-smoke-test.mjs
 *
 * The community chat topic is `message` (the client subscribes to it in
 * `useRealtimeChat` / `useSidebarRealtime` and the server publishes it from
 * `publishChatEvent`). `chat` is the ROOM prefix, not a topic — subscribing to
 * it receives nothing, which is how the old revision of this script passed
 * while delivering no community event at all.
 */

import { SignJWT } from "jose";
import WebSocket from "ws";
import { assertStagingTarget, userIdForIndex } from "./lib/realtime-fanout.mjs";

const RAW_BASE =
  process.env.REALTIME_URL || process.env.WS_BASE_URL || "https://uxcommunity-realtime-staging.patilsachin1228.workers.dev";
const BASE = RAW_BASE.replace(/^wss:/, "https:").replace(/^ws:/, "http:").replace(/\/+$/, "");
const WS_BASE = BASE.replace(/^http/, "ws");
const SESSION_SECRET = process.env.SESSION_SECRET;
const PUBLISH_SECRET = process.env.REALTIME_PUBLISH_SECRET;
const COMMUNITY_ID = process.env.TEST_COMMUNITY_ID;
const TOPIC = process.env.TOPIC || "message";
const ROOM = `chat:${COMMUNITY_ID}`;

const missing = [
  ["SESSION_SECRET", SESSION_SECRET],
  ["REALTIME_PUBLISH_SECRET", PUBLISH_SECRET],
  ["TEST_COMMUNITY_ID", COMMUNITY_ID],
].filter(([, value]) => !value);
if (missing.length > 0) {
  console.error(`Missing required env: ${missing.map(([name]) => name).join(", ")}`);
  process.exit(2);
}

const target = assertStagingTarget(BASE, { allowNonStaging: process.env.ALLOW_NON_STAGING === "1" });
if (!target.ok) {
  console.error(`\nERROR: ${target.reason}\n`);
  process.exit(2);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function createToken(userId) {
  return new SignJWT({ userId, email: `${userId}@smoke.test`, role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SESSION_SECRET));
}

async function roomStats() {
  try {
    const response = await fetch(`${BASE}/stats?room=${encodeURIComponent(ROOM)}`, {
      headers: { "x-realtime-publish-secret": PUBLISH_SECRET },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function main() {
  const userId = userIdForIndex(0, "smoke");
  const token = await createToken(userId);

  console.log("=== STAGING REALTIME SMOKE TEST ===");
  console.log(`  Target:            ${BASE}`);
  console.log(`  TARGET ROOM:       ${ROOM}`);
  console.log(`  Topic:             ${TOPIC}`);
  console.log(`  User:              ${userId}`);
  console.log("");

  const before = await roomStats();
  if (!before) {
    console.error("  FATAL: GET /stats failed — is this deployment the current Worker (audit PR #537+)?");
    process.exit(2);
  }
  console.log(`  [0] /stats          sockets=${before.sockets} subscriptionRefs=${before.subscriptionRefs} instance=${before.instanceId}`);

  console.log("  [1] Connecting…");
  const connectStart = Date.now();
  const ws = new WebSocket(`${WS_BASE}/ws?room=${encodeURIComponent(ROOM)}&token=${encodeURIComponent(token)}`);
  let hello = null;
  let delivered = null;
  let closeCode = null;
  ws.on("message", (data) => {
    const raw = String(data);
    if (raw === "pong") return;
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.t === "hello") hello = message;
    if (message.t === "event" && message.room === ROOM && message.topic === TOPIC) delivered = message;
  });
  ws.on("close", (code) => {
    closeCode = code;
  });

  const opened = await new Promise((resolve) => {
    ws.once("open", () => resolve(true));
    ws.once("unexpected-response", (_request, response) => resolve(response.statusCode));
    ws.once("error", () => resolve(false));
    setTimeout(() => resolve(false), 10000);
  });
  if (opened !== true) {
    console.error(`  FATAL: connection did not upgrade (${opened === false ? "error/timeout" : `HTTP ${opened}`})`);
    process.exit(1);
  }
  console.log(`  [1] Connected in ${Date.now() - connectStart}ms`);

  console.log("  [2] join + subscribe…");
  ws.send(JSON.stringify({ t: "join", user: { id: userId, name: "Smoke Test", avatar: null } }));
  ws.send(JSON.stringify({ t: "subscribe", room: ROOM, topic: TOPIC }));

  const subscribeDeadline = Date.now() + 10000;
  let subscribed = false;
  while (Date.now() < subscribeDeadline && !hello) await sleep(100);
  while (Date.now() < subscribeDeadline) {
    const stats = await roomStats();
    if (stats && stats.subscriptionRefs >= 1) {
      subscribed = true;
      console.log(`  [2] /stats confirms subscriptionRefs=${stats.subscriptionRefs} sockets=${stats.sockets}`);
      break;
    }
    await sleep(250);
  }
  if (!hello) {
    console.error("  FATAL: no hello frame — the DO did not accept the join");
    process.exit(1);
  }
  console.log(`  [2] hello received (connectionId=${hello.connectionId ?? "?"})`);
  if (!subscribed) {
    console.error("  FATAL: the Durable Object never reported the subscription");
    process.exit(1);
  }

  console.log("  [3] Publishing through the server-side path…");
  const sentAt = Date.now();
  const publishResponse = await fetch(`${BASE}/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-realtime-publish-secret": PUBLISH_SECRET },
    body: JSON.stringify({
      room: ROOM,
      topic: TOPIC,
      data: {
        id: `smoke-${sentAt}`,
        community_id: COMMUNITY_ID,
        user_id: userId,
        sender_name: "Smoke Test",
        content: `staging smoke ${sentAt}`,
        created_at: new Date(sentAt).toISOString(),
        mentions: [],
      },
    }),
    signal: AbortSignal.timeout(10000),
  });
  console.log(`  [3] /publish → HTTP ${publishResponse.status} ${await publishResponse.text()}`);

  const deliveryDeadline = Date.now() + 15000;
  while (Date.now() < deliveryDeadline && !delivered) await sleep(100);

  if (!delivered) {
    console.error("  FATAL: published event never arrived on the subscribed socket");
    ws.close();
    process.exit(1);
  }
  console.log(`  [4] Event received after ${Date.now() - sentAt}ms`);
  console.log(`      room=${delivered.room} topic=${delivered.topic} sender=${delivered.sender}`);
  console.log(`      data=${JSON.stringify(delivered.data).slice(0, 160)}`);

  ws.close();
  await sleep(1500);
  const after = await roomStats();
  if (after) {
    console.log(
      `  [5] /stats after close sockets=${after.sockets} subscriptionRefs=${after.subscriptionRefs} ` +
        `eventsPublished=${after.metrics?.eventsPublished}`,
    );
  }
  console.log(`      closeCode=${closeCode}`);
  console.log("");
  console.log("=== SMOKE TEST PASSED — same room, same topic, server-side publish, real delivery ===");
}

main().catch((error) => {
  console.error("SMOKE TEST FAILED:", error);
  process.exit(1);
});
