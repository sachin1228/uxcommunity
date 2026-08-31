#!/usr/bin/env node
/**
 * 5,000 Concurrent User Production Realtime Load Test
 *
 * Tests the production WebSocket endpoint at wss://rt.uxcommunity.in
 * with 5,000 simultaneous connections, subscriptions, and a single
 * message fan-out.
 *
 * Usage:
 *   SESSION_SECRET=xxx REALTIME_PUBLISH_SECRET=xxx TEST_COMMUNITY_ID=uuid \
 *     node k6/loadtest-5k.mjs
 */

import { SignJWT } from "jose";
import WebSocket from "ws";
import http from "http";
import https from "https";

// ── Configuration ────────────────────────────────────────────────────────
const WS_BASE_URL = process.env.WS_BASE_URL || "wss://rt.uxcommunity.in";
const PUBLISH_BASE_URL = process.env.PUBLISH_BASE_URL || "https://rt.uxcommunity.in";
const SESSION_SECRET = process.env.SESSION_SECRET;
const PUBLISH_SECRET = process.env.REALTIME_PUBLISH_SECRET;
const COMMUNITY_ID = process.env.TEST_COMMUNITY_ID;
const CROSS_COMMUNITY_ID = process.env.CROSS_COMMUNITY_ID || "00000000-0000-0000-0000-000000000001";
const TOTAL_CLIENTS = parseInt(process.env.TOTAL_CLIENTS || "5000", 10);
const CONTROL_GROUP_SIZE = parseInt(process.env.CONTROL_GROUP_SIZE || "100", 10);
const RAMP_BATCH = parseInt(process.env.RAMP_BATCH || "250", 10);
const RAMP_DELAY_MS = parseInt(process.env.RAMP_DELAY_MS || "80", 10);
const CONNECTION_TIMEOUT_MS = parseInt(process.env.CONNECTION_TIMEOUT_MS || "20000", 10);
const MESSAGE_WAIT_TIMEOUT_MS = parseInt(process.env.MESSAGE_WAIT_TIMEOUT_MS || "45000", 10);

const MAIN_GROUP_SIZE = TOTAL_CLIENTS - CONTROL_GROUP_SIZE;

if (!SESSION_SECRET || !PUBLISH_SECRET || !COMMUNITY_ID) {
  console.error(`
ERROR: Missing required environment variables.

  SESSION_SECRET          — ${SESSION_SECRET ? "✓" : "✗ MISSING"}
  REALTIME_PUBLISH_SECRET — ${PUBLISH_SECRET ? "✓" : "✗ MISSING"}
  TEST_COMMUNITY_ID       — ${COMMUNITY_ID ? "✓" : "✗ MISSING"}
`);
  process.exit(1);
}

// ── Metrics ──────────────────────────────────────────────────────────────
const metrics = {
  connectionAttempted: 0,
  connectionSuccess: 0,
  connectionFailed: 0,
  connectionFailureReasons: {},
  connectionTimes: [],

  subscriptionAttempted: 0,
  subscriptionSuccess: 0,
  subscriptionFailed: 0,

  publishTimestamp: null,
  messageReceived: 0,
  deliveryLatencies: [],
  duplicates: 0,
  duplicateDetection: new Map(),

  controlReceived: 0,
};

// ── JWT Generation ───────────────────────────────────────────────────────
async function createToken(userId) {
  const secret = new TextEncoder().encode(SESSION_SECRET);
  return new SignJWT({ userId, email: `loadtest-${userId}@k6test.invalid`, role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

function buildWsUrl(token, userId) {
  return `${WS_BASE_URL}/ws?room=user:${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function publishMessage(room, topic, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${PUBLISH_BASE_URL}/publish`);
    const body = JSON.stringify({ room, topic, data });
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-realtime-publish-secret": PUBLISH_SECRET,
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function printProgress(current, total, label) {
  const pct = ((current / total) * 100).toFixed(1);
  const filled = Math.floor((current / total) * 40);
  const bar = "█".repeat(filled) + "░".repeat(40 - filled);
  process.stdout.write(`\r  ${label}: [${bar}] ${pct}% (${current}/${total})`);
  if (current === total) process.stdout.write("\n");
}

// ── MAIN ─────────────────────────────────────────────────────────────────
async function main() {
  const testStartTime = Date.now();

  console.log("=".repeat(70));
  console.log("  5,000 CONCURRENT USER PRODUCTION REALTIME LOAD TEST");
  console.log("=".repeat(70));
  console.log(`  Target:          ${WS_BASE_URL}`);
  console.log(`  Community:       ${COMMUNITY_ID}`);
  console.log(`  Control comm:    ${CROSS_COMMUNITY_ID}`);
  console.log(`  Main group:      ${MAIN_GROUP_SIZE} clients`);
  console.log(`  Control group:   ${CONTROL_GROUP_SIZE} clients (subscribe to DIFFERENT community)`);
  console.log(`  Total clients:   ${TOTAL_CLIENTS}`);
  console.log(`  Started at:      ${new Date(testStartTime).toISOString()}`);
  console.log("=".repeat(70));

  // ── Pre-generate JWTs ────────────────────────────────────────────────
  console.log("\n[PREP] Generating JWT tokens...");
  const tokens = new Map();
  const userIds = [];
  for (let i = 0; i < TOTAL_CLIENTS; i++) {
    const userId = `loadtest-${String(i + 1).padStart(5, "0")}`;
    userIds.push(userId);
    tokens.set(userId, await createToken(userId));
  }
  console.log(`[PREP] ${tokens.size} tokens generated.`);

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 1 — CONNECTION TEST
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("  PHASE 1 — CONNECTION TEST");
  console.log("─".repeat(70));

  const clients = [];
  let connectedCount = 0;
  let failedCount = 0;
  const failureReasons = {};

  for (let batchStart = 0; batchStart < TOTAL_CLIENTS; batchStart += RAMP_BATCH) {
    const batchEnd = Math.min(batchStart + RAMP_BATCH, TOTAL_CLIENTS);
    const batchPromises = [];

    for (let i = batchStart; i < batchEnd; i++) {
      const userId = userIds[i];
      const token = tokens.get(userId);
      const url = buildWsUrl(token, userId);
      const isControl = i >= MAIN_GROUP_SIZE;

      metrics.connectionAttempted++;

      const promise = new Promise((resolve) => {
        const connectStart = Date.now();
        let ws;
        try {
          ws = new WebSocket(url);
        } catch (err) {
          failedCount++;
          failureReasons[err.message || "unknown"] = (failureReasons[err.message || "unknown"] || 0) + 1;
          resolve(null);
          return;
        }

        const timeout = setTimeout(() => {
          failedCount++;
          failureReasons["timeout"] = (failureReasons["timeout"] || 0) + 1;
          try { ws.close(); } catch {}
          resolve(null);
        }, CONNECTION_TIMEOUT_MS);

        ws.on("open", () => {
          clearTimeout(timeout);
          metrics.connectionTimes.push(Date.now() - connectStart);
          connectedCount++;
          metrics.connectionSuccess++;
          resolve({ id: userId, ws, isControl, connectedAt: Date.now() });
        });

        ws.on("error", (err) => {
          clearTimeout(timeout);
          failedCount++;
          failureReasons[err.message || "error"] = (failureReasons[err.message || "error"] || 0) + 1;
          resolve(null);
        });
      });

      batchPromises.push(promise);
    }

    const batch = await Promise.all(batchPromises);
    for (const c of batch) {
      if (c) clients.push(c);
    }
    printProgress(connectedCount + failedCount, TOTAL_CLIENTS, "Connecting");

    if (batchStart + RAMP_BATCH < TOTAL_CLIENTS) {
      await sleep(RAMP_DELAY_MS);
    }
  }

  // Wait for hello responses
  await sleep(2000);

  // Send join messages
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({
        t: "join",
        user: { id: client.id, name: `Load ${client.id}`, avatar: null },
      }));
    }
  }
  await sleep(1000);

  console.log(`\n  Phase 1 Results:`);
  console.log(`  Attempted:               ${metrics.connectionAttempted}`);
  console.log(`  Successfully connected:  ${metrics.connectionSuccess}`);
  console.log(`  Failed:                  ${metrics.connectionFailed}`);
  console.log(`  Failure reasons:         ${JSON.stringify(failureReasons)}`);
  if (metrics.connectionTimes.length > 0) {
    console.log(`\n  Connection establishment time:`);
    console.log(`    P50:  ${percentile(metrics.connectionTimes, 50)}ms`);
    console.log(`    P95:  ${percentile(metrics.connectionTimes, 95)}ms`);
    console.log(`    P99:  ${percentile(metrics.connectionTimes, 99)}ms`);
    console.log(`    Max:  ${Math.max(...metrics.connectionTimes)}ms`);
  }

  if (connectedCount === 0) {
    console.error("\n  FATAL: No clients connected. Aborting.");
    process.exit(1);
  }

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 2 — SUBSCRIPTION TEST
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("  PHASE 2 — SUBSCRIPTION TEST");
  console.log("─".repeat(70));

  const mainClients = clients.filter((c) => !c.isControl);
  const controlClients = clients.filter((c) => c.isControl);

  let mainSubsSent = 0;
  let controlSubsSent = 0;

  // ONLY main group subscribes to the test community
  for (const client of mainClients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    client.ws.send(JSON.stringify({ t: "subscribe", room: `chat:${COMMUNITY_ID}`, topic: "chat" }));
    mainSubsSent++;
    metrics.subscriptionAttempted++;
  }

  // Control group subscribes ONLY to a DIFFERENT community (cross-community isolation test)
  for (const client of controlClients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    client.ws.send(JSON.stringify({ t: "subscribe", room: `chat:${CROSS_COMMUNITY_ID}`, topic: "chat" }));
    controlSubsSent++;
    metrics.subscriptionAttempted++;
  }

  console.log(`  Main subscriptions sent:     ${mainSubsSent}`);
  console.log(`  Control subscriptions sent:  ${controlSubsSent} (different community)`);
  console.log("  Waiting for subscriptions to propagate...");

  await sleep(8000);

  const activeClients = clients.filter((c) => c.ws.readyState === WebSocket.OPEN);
  metrics.subscriptionSuccess = activeClients.length;
  metrics.subscriptionFailed = metrics.subscriptionAttempted - metrics.subscriptionSuccess;

  console.log(`\n  Phase 2 Results:`);
  console.log(`  Expected subscriptions:  ${metrics.subscriptionAttempted}`);
  console.log(`  Successful:              ${metrics.subscriptionSuccess}`);
  console.log(`  Failed:                  ${metrics.subscriptionFailed}`);

  if (activeClients.length === 0) {
    console.error("\n  FATAL: No active clients.");
    process.exit(1);
  }

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 3 — ONE MESSAGE FAN-OUT
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("  PHASE 3 — ONE MESSAGE FAN-OUT");
  console.log("─".repeat(70));

  // Reset all delivery tracking
  metrics.messageReceived = 0;
  metrics.deliveryLatencies = [];
  metrics.duplicateDetection.clear();
  metrics.controlReceived = 0;
  for (const client of clients) {
    client.receivedAt = null;
    client.receivedEvents = [];
  }

  // Attach event listeners that capture the publishTimestamp reference
  for (const client of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;

    client.ws.removeAllListeners("message");
    client.ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.t === "event" && metrics.publishTimestamp !== null) {
          const now = Date.now();
          client.receivedAt = now;
          client.receivedEvents.push({ room: msg.room, topic: msg.topic, data: msg.data, receivedAt: now });

          const count = metrics.duplicateDetection.get(client.id) || 0;
          metrics.duplicateDetection.set(client.id, count + 1);
          if (count > 0) metrics.duplicates++;

          metrics.messageReceived++;
          metrics.deliveryLatencies.push(now - metrics.publishTimestamp);
        }
      } catch {}
    });
  }

  // Drain any stale messages
  await sleep(500);

  console.log(`  Sending ONE test message to chat:${COMMUNITY_ID}...`);

  // Record timestamp BEFORE the publish call (this is the closest to server-side publish time)
  metrics.publishTimestamp = Date.now();
  const publishStartTime = metrics.publishTimestamp;

  try {
    const result = await publishMessage(`chat:${COMMUNITY_ID}`, "chat", {
      type: "load-test",
      testId: `5k-${Date.now()}`,
      timestamp: publishStartTime,
      message: "5,000 concurrent user load test message",
    });
    console.log(`  Publish response: ${result.status} (${result.body})`);
    console.log(`  Publish timestamp: ${new Date(publishStartTime).toISOString()}`);
  } catch (err) {
    console.error(`  Publish FAILED: ${err.message}`);
    process.exit(1);
  }

  // Wait for deliveries
  const activeMainClients = mainClients.filter((c) => c.ws.readyState === WebSocket.OPEN);
  const expectedDeliveries = activeMainClients.length;
  console.log(`  Waiting for delivery to ${expectedDeliveries} main-group clients...`);

  const waitStart = Date.now();
  let lastPct = -1;
  while (Date.now() - waitStart < MESSAGE_WAIT_TIMEOUT_MS) {
    const received = activeMainClients.filter((c) => c.receivedAt !== null).length;
    const pct = Math.floor((received / expectedDeliveries) * 100);
    if (pct > lastPct) {
      printProgress(received, expectedDeliveries, "Delivery");
      lastPct = pct;
    }
    if (received >= expectedDeliveries) break;
    await sleep(100);
  }
  const received = activeMainClients.filter((c) => c.receivedAt !== null).length;
  printProgress(received, expectedDeliveries, "Delivery");

  // Check control group
  const activeControlClients = controlClients.filter((c) => c.ws.readyState === WebSocket.OPEN);
  metrics.controlReceived = activeControlClients.filter((c) => c.receivedAt !== null).length;

  const missing = expectedDeliveries - metrics.messageReceived;

  console.log(`\n  Phase 3 Results:`);
  console.log(`  Expected deliveries:  ${expectedDeliveries}`);
  console.log(`  Actual deliveries:    ${metrics.messageReceived}`);
  console.log(`  Missing:              ${missing}`);
  console.log(`  Duplicates:           ${metrics.duplicates}`);

  if (metrics.deliveryLatencies.length > 0) {
    console.log(`\n  Delivery latency (from publish timestamp):`);
    console.log(`    P50:  ${percentile(metrics.deliveryLatencies, 50)}ms`);
    console.log(`    P95:  ${percentile(metrics.deliveryLatencies, 95)}ms`);
    console.log(`    P99:  ${percentile(metrics.deliveryLatencies, 99)}ms`);
    console.log(`    Max:  ${Math.max(...metrics.deliveryLatencies)}ms`);

    const buckets = [
      { label: "<100ms", min: 0, max: 100 },
      { label: "<250ms", min: 100, max: 250 },
      { label: "<500ms", min: 250, max: 500 },
      { label: "<1s",    min: 500, max: 1000 },
      { label: "<2s",    min: 1000, max: 2000 },
      { label: "<5s",    min: 2000, max: 5000 },
      { label: ">5s",    min: 5000, max: Infinity },
    ];
    console.log(`\n  Delivery distribution:`);
    for (const b of buckets) {
      const count = metrics.deliveryLatencies.filter((t) => t >= b.min && t < b.max).length;
      console.log(`    ${b.label.padEnd(8)} ${count}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 4 — CROSS-COMMUNITY LEAK CHECK
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("  PHASE 4 — VERIFY NO CROSS-COMMUNITY LEAK");
  console.log("─".repeat(70));
  console.log(`  Control group (subscribed to ${CROSS_COMMUNITY_ID}):`);
  console.log(`    Size:              ${activeControlClients.length}`);
  console.log(`    Received events:   ${metrics.controlReceived}`);
  console.log(`    Cross-community leaks: ${metrics.controlReceived} (expected: 0)`);

  // ════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n[CLEANUP] Closing WebSocket connections...");
  for (const client of clients) {
    try {
      if (client.ws.readyState === WebSocket.OPEN || client.ws.readyState === WebSocket.CONNECTING) {
        client.ws.close();
      }
    } catch {}
  }
  await sleep(1000);

  const testEndTime = Date.now();
  const testDuration = ((testEndTime - testStartTime) / 1000).toFixed(1);

  // ════════════════════════════════════════════════════════════════════════
  // FINAL REPORT
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n" + "=".repeat(70));
  console.log("  5,000 CONCURRENT USER TEST — FINAL REPORT");
  console.log("=".repeat(70));
  console.log(`  Test duration: ${testDuration}s`);
  console.log(`  Target: ${WS_BASE_URL}`);
  console.log(`  Community: ${COMMUNITY_ID}`);
  console.log("");

  console.log("Connections");
  console.log("-----------");
  console.log(`  Attempted:              ${metrics.connectionAttempted}`);
  console.log(`  Connected:              ${metrics.connectionSuccess}`);
  console.log(`  Failed:                 ${metrics.connectionFailed}`);
  if (Object.keys(failureReasons).length > 0) {
    console.log(`  Failure reasons:        ${JSON.stringify(failureReasons)}`);
  }
  console.log("");

  if (metrics.connectionTimes.length > 0) {
    console.log("Connection establishment time");
    console.log("-----------------------------");
    console.log(`  P50:  ${percentile(metrics.connectionTimes, 50)}ms`);
    console.log(`  P95:  ${percentile(metrics.connectionTimes, 95)}ms`);
    console.log(`  P99:  ${percentile(metrics.connectionTimes, 99)}ms`);
    console.log(`  Max:  ${Math.max(...metrics.connectionTimes)}ms`);
    console.log("");
  }

  console.log("Subscriptions");
  console.log("-------------");
  console.log(`  Expected:   ${metrics.subscriptionAttempted}`);
  console.log(`  Successful:  ${metrics.subscriptionSuccess}`);
  console.log(`  Failed:      ${metrics.subscriptionFailed}`);
  console.log("");

  console.log("Fan-out");
  console.log("-------");
  console.log(`  Expected deliveries:  ${expectedDeliveries}`);
  console.log(`  Actual deliveries:    ${metrics.messageReceived}`);
  console.log(`  Missing:              ${missing}`);
  console.log(`  Duplicates:           ${metrics.duplicates}`);
  console.log("");

  console.log("Latency");
  console.log("-------");
  if (metrics.deliveryLatencies.length > 0) {
    console.log(`  P50:  ${percentile(metrics.deliveryLatencies, 50)}ms`);
    console.log(`  P95:  ${percentile(metrics.deliveryLatencies, 95)}ms`);
    console.log(`  P99:  ${percentile(metrics.deliveryLatencies, 99)}ms`);
    console.log(`  Max:  ${Math.max(...metrics.deliveryLatencies)}ms`);
    console.log("");

    const buckets = [
      { label: "<100ms", min: 0, max: 100 },
      { label: "<250ms", min: 100, max: 250 },
      { label: "<500ms", min: 250, max: 500 },
      { label: "<1s",    min: 500, max: 1000 },
      { label: "<2s",    min: 1000, max: 2000 },
      { label: "<5s",    min: 2000, max: 5000 },
      { label: ">5s",    min: 5000, max: Infinity },
    ];
    for (const b of buckets) {
      const count = metrics.deliveryLatencies.filter((t) => t >= b.min && t < b.max).length;
      console.log(`  ${b.label.padEnd(8)} ${count}`);
    }
  } else {
    console.log("  No deliveries recorded.");
  }
  console.log("");

  console.log("Cloudflare DELTA");
  console.log("----------------");
  console.log("  (Requires Cloudflare dashboard comparison:)");
  console.log("  Go to: Workers & Pages → uxcommunity-realtime → Metrics");
  console.log("  Compare before-test baseline with after-test numbers.");
  console.log("");

  console.log("Errors");
  console.log("------");
  console.log(`  1102:  (check Cloudflare dashboard)`);
  console.log(`  1015:  (check Cloudflare dashboard)`);
  console.log(`  4xx:   (check Cloudflare dashboard)`);
  console.log(`  5xx:   (check Cloudflare dashboard)`);
  console.log(`  Other: ${JSON.stringify(failureReasons)}`);
  console.log("");

  console.log("Cross-community leaks");
  console.log("----------------------");
  console.log(`  Expected: 0`);
  console.log(`  Actual:   ${metrics.controlReceived}`);
  console.log("");

  console.log("FINAL VERDICT");
  console.log("-------------");
  const pass =
    metrics.connectionSuccess >= TOTAL_CLIENTS * 0.99 &&
    metrics.messageReceived >= expectedDeliveries * 0.99 &&
    metrics.duplicates === 0 &&
    metrics.controlReceived === 0;

  if (pass) {
    console.log("  PASS");
  } else {
    console.log("  FAIL");
    const reasons = [];
    if (metrics.connectionSuccess < TOTAL_CLIENTS * 0.99)
      reasons.push(`Only ${metrics.connectionSuccess}/${TOTAL_CLIENTS} connected (need >=99%)`);
    if (metrics.messageReceived < expectedDeliveries * 0.99)
      reasons.push(`Only ${metrics.messageReceived}/${expectedDeliveries} delivered (need >=99%)`);
    if (metrics.duplicates > 0) reasons.push(`${metrics.duplicates} duplicates found`);
    if (metrics.controlReceived > 0) reasons.push(`${metrics.controlReceived} cross-community leaks`);
    for (const r of reasons) console.log(`    - ${r}`);
  }

  console.log("\n" + "=".repeat(70));
  console.log("  STOP — Test complete. No additional messages sent.");
  console.log("=".repeat(70));
}

main().catch((err) => {
  console.error("\nFATAL ERROR:", err);
  process.exit(1);
});
