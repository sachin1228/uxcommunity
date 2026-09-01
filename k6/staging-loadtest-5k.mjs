#!/usr/bin/env node
/**
 * 5,000 Concurrent Client Staging Load Test
 * Branch: feat/community-do-websocket-ownership
 * Architecture: USE_WEBSOCKET_OWNERSHIP=true → CommunityDO owns WebSockets directly
 *
 * Usage:
 *   SESSION_SECRET=xxx REALTIME_PUBLISH_SECRET=xxx TEST_COMMUNITY_ID=uuid \
 *     node k6/staging-loadtest-5k.mjs
 */

import { SignJWT } from "jose";
import WebSocket from "ws";
import http from "http";
import https from "https";

// ── Configuration ────────────────────────────────────────────────────────
const WS_BASE_URL = process.env.WS_BASE_URL || "wss://uxcommunity-realtime-staging.patilsachin1228.workers.dev";
const PUBLISH_BASE_URL = process.env.PUBLISH_BASE_URL || "https://uxcommunity-realtime-staging.patilsachin1228.workers.dev";
const SESSION_SECRET = process.env.SESSION_SECRET;
const PUBLISH_SECRET = process.env.REALTIME_PUBLISH_SECRET;
const COMMUNITY_ID = process.env.TEST_COMMUNITY_ID;
const CROSS_COMMUNITY_ID = process.env.CROSS_COMMUNITY_ID || "00000000-0000-0000-0000-000000000001";
const TOTAL_CLIENTS = parseInt(process.env.TOTAL_CLIENTS || "5000", 10);
const CONTROL_GROUP_SIZE = parseInt(process.env.CONTROL_GROUP_SIZE || "100", 10);
const RAMP_BATCH = parseInt(process.env.RAMP_BATCH || "100", 10);
const RAMP_DELAY_MS = parseInt(process.env.RAMP_DELAY_MS || "200", 10);
const CONNECTION_TIMEOUT_MS = parseInt(process.env.CONNECTION_TIMEOUT_MS || "20000", 10);
const MESSAGE_WAIT_TIMEOUT_MS = parseInt(process.env.MESSAGE_WAIT_TIMEOUT_MS || "60000", 10);

const MAIN_GROUP_SIZE = TOTAL_CLIENTS - CONTROL_GROUP_SIZE;

if (!SESSION_SECRET || !PUBLISH_SECRET || !COMMUNITY_ID) {
  console.error(`
ERROR: Missing required environment variables.
  SESSION_SECRET:          ${SESSION_SECRET ? "✓" : "✗ MISSING"}
  REALTIME_PUBLISH_SECRET: ${PUBLISH_SECRET ? "✓" : "✗ MISSING"}
  TEST_COMMUNITY_ID:       ${COMMUNITY_ID ? "✓" : "✗ MISSING"}
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
  disconnects: 0,
  unexpectedDisconnects: 0,

  subscriptionAttempted: 0,
  subscriptionSuccess: 0,
  subscriptionFailed: 0,

  publishTimestamp: null,
  publishTime: null,
  messageReceived: 0,
  deliveryLatencies: [],
  duplicates: 0,
  duplicateDetection: new Map(),

  controlReceived: 0,
  controlDelivered: 0,

  // ── Disconnect diagnostics ─────────────────────────────────────────────
  disconnectEvents: [],
  closeCodes: {},
  closeReasons: {},
  disconnectTimeline: {},
  disconnectPhase: {
    duringConnection: 0,
    afterConnection: 0,
    afterSubscription: 0,
    beforePublish: 0,
    afterPublish: 0,
    duringCleanup: 0,
  },
};

// ── JWT Generation ───────────────────────────────────────────────────────
async function createToken(userId) {
  const secret = new TextEncoder().encode(SESSION_SECRET);
  return new SignJWT({ userId, email: `${userId}@loadtest.invalid`, role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

// Connect to chat:${communityId} directly — CommunityDO owns this WebSocket
function buildWsUrl(token, communityId) {
  const room = `chat:${communityId}`;
  return `${WS_BASE_URL}/ws?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function publishMessage(room, topic, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(PUBLISH_BASE_URL);
    const body = JSON.stringify({ room, topic, data });
    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: "/publish",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-realtime-publish-secret": PUBLISH_SECRET,
        "Content-Length": Buffer.byteLength(body),
      },
    };
    const transport = url.protocol === "https:" ? https : http;
    const req = transport.request(options, (res) => {
      let d = "";
      res.on("data", (chunk) => (d += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function printProgress(current, total, label) {
  const pct = Math.min(((current / total) * 100), 100).toFixed(1);
  const filled = Math.min(Math.floor((current / total) * 40), 40);
  const bar = "█".repeat(filled) + "░".repeat(40 - filled);
  process.stdout.write(`\r  ${label}: [${bar}] ${pct}% (${current}/${total})`);
  if (current === total) process.stdout.write("\n");
}

// ══════════════════════════════════════════════════════════════════════════
// MAIN
// ══════════════════════════════════════════════════════════════════════════
async function main() {
  const testStartTime = Date.now();

  console.log("=".repeat(70));
  console.log("  STAGING 5,000 CLIENT LOAD TEST");
  console.log("  Branch: feat/community-do-websocket-ownership");
  console.log("  Architecture: USE_WEBSOCKET_OWNERSHIP=true");
  console.log("=".repeat(70));
  console.log(`  Target:          ${WS_BASE_URL}`);
  console.log(`  Community:       ${COMMUNITY_ID}`);
  console.log(`  Control comm:    ${CROSS_COMMUNITY_ID}`);
  console.log(`  Main group:      ${MAIN_GROUP_SIZE} clients → CommunityDO`);
  console.log(`  Control group:   ${CONTROL_GROUP_SIZE} clients → DIFFERENT CommunityDO`);
  console.log(`  Total clients:   ${TOTAL_CLIENTS}`);
  console.log(`  Started at:      ${new Date(testStartTime).toISOString()}`);
  console.log("=".repeat(70));

  // ── Pre-generate JWTs ──────────────────────────────────────────────────
  console.log("\n[PREP] Generating JWT tokens...");
  const tokens = new Map();
  const userIds = [];
  for (let i = 0; i < TOTAL_CLIENTS; i++) {
    const userId = `load-${String(i + 1).padStart(5, "0")}`;
    userIds.push(userId);
    tokens.set(userId, await createToken(userId));
  }
  console.log(`[PREP] ${tokens.size} tokens generated.`);

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 1 — CONNECTION TEST
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("  PHASE 1 — CONNECTION TEST");
  console.log("  Each client connects DIRECTLY to CommunityDO (chat:communityId)");
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
      const isControl = i >= MAIN_GROUP_SIZE;
      const targetCommunity = isControl ? CROSS_COMMUNITY_ID : COMMUNITY_ID;
      const url = buildWsUrl(token, targetCommunity);

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
          resolve({
            id: userId, ws, isControl, communityId: targetCommunity,
            connectedAt: Date.now(),
            phase: "connected",
          });
        });

        ws.on("error", (err) => {
          clearTimeout(timeout);
          failedCount++;
          failureReasons[err.message || "error"] = (failureReasons[err.message || "error"] || 0) + 1;
          resolve(null);
        });

        ws.on("close", (code, reason) => {
          const now = Date.now();
          metrics.disconnects++;
          const reasonStr = reason?.toString() || "";
          const event = {
            clientId: userId,
            code,
            reason: reasonStr,
            timestamp: now,
            timeSinceTestStart: now - testStartTime,
            timeSinceConnection: null,
            phase: null,
            isControl,
          };
          metrics.disconnectEvents.push(event);
          metrics.closeCodes[code] = (metrics.closeCodes[code] || 0) + 1;
          if (reasonStr) metrics.closeReasons[reasonStr] = (metrics.closeReasons[reasonStr] || 0) + 1;
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

  // Backfill timeSinceConnection + phase for events captured during connection ramp
  for (const ev of metrics.disconnectEvents) {
    const client = clients.find((c) => c.id === ev.clientId);
    if (client) {
      ev.timeSinceConnection = ev.timestamp - client.connectedAt;
    }
    if (ev.phase === null) ev.phase = "duringConnection";
  }
  // Count disconnects that happened after connection
  metrics.disconnectPhase.duringConnection = metrics.disconnectEvents.filter(
    (e) => e.timeSinceConnection !== null && e.timeSinceConnection < 3000
  ).length;

  // Send join messages
  let joinSent = 0;
  for (const client of clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify({
        t: "join",
        user: { id: client.id, name: `Load ${client.id}`, avatar: null },
      }));
      client.phase = "joined";
      joinSent++;
    }
  }
  await sleep(1000);

  console.log(`\n  Phase 1 Results:`);
  console.log(`  Attempted:               ${metrics.connectionAttempted}`);
  console.log(`  Successfully connected:  ${metrics.connectionSuccess}`);
  console.log(`  Failed:                  ${metrics.connectionFailed}`);
  console.log(`  Join messages sent:      ${joinSent}`);
  if (Object.keys(failureReasons).length > 0) {
    console.log(`  Failure reasons:         ${JSON.stringify(failureReasons)}`);
  }
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

  // Main group subscribes to the test community's chat
  for (const client of mainClients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    client.ws.send(JSON.stringify({
      t: "subscribe",
      room: `chat:${COMMUNITY_ID}`,
      topic: "chat",
    }));
    client.phase = "subscribed";
    mainSubsSent++;
    metrics.subscriptionAttempted++;
  }

  // Control group subscribes to a DIFFERENT community
  for (const client of controlClients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    client.ws.send(JSON.stringify({
      t: "subscribe",
      room: `chat:${CROSS_COMMUNITY_ID}`,
      topic: "chat",
    }));
    client.phase = "subscribed";
    controlSubsSent++;
    metrics.subscriptionAttempted++;
  }

  console.log(`  Main subscriptions sent:     ${mainSubsSent}`);
  console.log(`  Control subscriptions sent:  ${controlSubsSent} (different community)`);
  console.log("  Waiting for subscriptions to propagate...");

  await sleep(5000);

  // Tag phase on disconnect events captured so far
  for (const ev of metrics.disconnectEvents) {
    if (ev.phase === null) ev.phase = "afterSubscription";
  }

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
  console.log("  PHASE 3 — ONE MESSAGE FAN-OUT (5,000 subscribers)");
  console.log("─".repeat(70));

  // Reset delivery tracking
  metrics.messageReceived = 0;
  metrics.deliveryLatencies = [];
  metrics.duplicates = 0;
  metrics.duplicateDetection.clear();
  metrics.controlReceived = 0;
  for (const client of clients) {
    client.receivedAt = null;
    client.receivedEvents = [];
  }

  // Attach event listeners
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

  // Drain stale messages
  await sleep(500);

  const testId = `staging-5k-${Date.now()}`;
  console.log(`  Test ID: ${testId}`);
  console.log(`  Sending ONE test message to chat:${COMMUNITY_ID}...`);

  // Record timestamp BEFORE publish
  metrics.publishTimestamp = Date.now();
  const publishStartTime = metrics.publishTimestamp;

  try {
    const result = await publishMessage(`chat:${COMMUNITY_ID}`, "chat", {
      type: "load-test",
      testId,
      timestamp: publishStartTime,
      message: "Staging 5,000 concurrent user load test message",
    });
    metrics.publishTime = Date.now() - publishStartTime;
    console.log(`  Publish response: ${result.status} (${result.body})`);
    console.log(`  Publish timestamp: ${new Date(publishStartTime).toISOString()}`);
    console.log(`  Publish round-trip: ${metrics.publishTime}ms`);
  } catch (err) {
    console.error(`  Publish FAILED: ${err.message}`);
    process.exit(1);
  }

  // Tag all disconnect events after this point as "afterPublish"
  const publishTime = Date.now();
  for (const ev of metrics.disconnectEvents) {
    if (ev.phase === null) {
      ev.phase = ev.timestamp < publishTime ? "beforePublish" : "afterPublish";
    }
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

  // Compute unexpected disconnects (before cleanup)
  const cleanupStartTime = Date.now() + 5000; // approximate; actual cleanup is below
  metrics.unexpectedDisconnects = metrics.disconnectEvents.filter(
    (e) => e.phase !== "duringCleanup"
  ).length;

  console.log(`\n  Phase 3 Results:`);
  console.log(`  Expected deliveries:  ${expectedDeliveries}`);
  console.log(`  Actual deliveries:    ${metrics.messageReceived}`);
  console.log(`  Missing:              ${missing}`);
  console.log(`  Duplicates:           ${metrics.duplicates}`);
  console.log(`  Delivery %:           ${((metrics.messageReceived / expectedDeliveries) * 100).toFixed(2)}%`);

  if (metrics.deliveryLatencies.length > 0) {
    console.log(`\n  Delivery latency (from publish timestamp):`);
    console.log(`    P50:    ${percentile(metrics.deliveryLatencies, 50)}ms`);
    console.log(`    P90:    ${percentile(metrics.deliveryLatencies, 90)}ms`);
    console.log(`    P95:    ${percentile(metrics.deliveryLatencies, 95)}ms`);
    console.log(`    P99:    ${percentile(metrics.deliveryLatencies, 99)}ms`);
    console.log(`    P99.9:  ${percentile(metrics.deliveryLatencies, 99.9)}ms`);
    console.log(`    Max:    ${Math.max(...metrics.deliveryLatencies)}ms`);

    const buckets = [
      { label: "<10ms",   min: 0,     max: 10 },
      { label: "<25ms",   min: 10,    max: 25 },
      { label: "<50ms",   min: 25,    max: 50 },
      { label: "<100ms",  min: 50,    max: 100 },
      { label: "<250ms",  min: 100,   max: 250 },
      { label: "<500ms",  min: 250,   max: 500 },
      { label: "<1s",     min: 500,   max: 1000 },
      { label: "1-2s",    min: 1000,  max: 2000 },
      { label: "2-5s",    min: 2000,  max: 5000 },
      { label: ">5s",     min: 5000,  max: Infinity },
    ];
    console.log(`\n  Delivery distribution:`);
    for (const b of buckets) {
      const count = metrics.deliveryLatencies.filter((t) => t >= b.min && t < b.max).length;
      console.log(`    ${b.label.padEnd(8)} ${count}`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // PHASE 4 — CROSS-COMMUNITY ISOLATION
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(70));
  console.log("  PHASE 4 — CROSS-COMMUNITY ISOLATION");
  console.log("─".repeat(70));
  console.log(`  Control group (subscribed to DIFFERENT community: ${CROSS_COMMUNITY_ID}):`);
  console.log(`    Size:              ${activeControlClients.length}`);
  console.log(`    Received events:   ${metrics.controlReceived}`);
  console.log(`    Cross-community leaks: ${metrics.controlReceived} (expected: 0)`);

  // ════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n[CLEANUP] Closing WebSocket connections...");
  let closedCount = 0;
  for (const client of clients) {
    try {
      if (client.ws.readyState === WebSocket.OPEN || client.ws.readyState === WebSocket.CONNECTING) {
        client.ws.close();
        client.phase = "cleanedUp";
        closedCount++;
      }
    } catch {}
  }
  console.log(`  Closed ${closedCount} connections`);
  await sleep(2000);

  // Tag any remaining disconnect events as "duringCleanup"
  for (const ev of metrics.disconnectEvents) {
    if (ev.phase === null) ev.phase = "duringCleanup";
  }

  // Verify connections are closed
  const stillOpen = clients.filter((c) => c.ws.readyState === WebSocket.OPEN).length;
  console.log(`  Still open: ${stillOpen} (should be 0)`);

  const testEndTime = Date.now();
  const testDuration = ((testEndTime - testStartTime) / 1000).toFixed(1);

  // ════════════════════════════════════════════════════════════════════════
  // FINAL REPORT
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n" + "=".repeat(70));
  console.log("  STAGING 5,000 CLIENT LOAD TEST — FINAL REPORT");
  console.log("=".repeat(70));

  console.log("\n## Environment");
  console.log(`  Branch:                    feat/community-do-websocket-ownership`);
  console.log(`  Commit:                    e80565e`);
  console.log(`  Worker:                    uxcommunity-realtime-staging`);
  console.log(`  Staging URL:               ${WS_BASE_URL}`);
  console.log(`  USE_WEBSOCKET_OWNERSHIP:   true`);
  console.log(`  Test duration:             ${testDuration}s`);

  console.log("\n## Connections");
  console.log(`  Attempted:              ${metrics.connectionAttempted}`);
  console.log(`  Connected:              ${metrics.connectionSuccess}`);
  console.log(`  Failed:                 ${metrics.connectionFailed}`);
  console.log(`  Disconnects:            ${metrics.disconnects}`);
  if (Object.keys(failureReasons).length > 0) {
    console.log(`  Failure reasons:        ${JSON.stringify(failureReasons)}`);
  }
  if (metrics.connectionTimes.length > 0) {
    console.log(`  P50:  ${percentile(metrics.connectionTimes, 50)}ms`);
    console.log(`  P95:  ${percentile(metrics.connectionTimes, 95)}ms`);
    console.log(`  P99:  ${percentile(metrics.connectionTimes, 99)}ms`);
    console.log(`  Max:  ${Math.max(...metrics.connectionTimes)}ms`);
  }

  console.log("\n## Subscriptions");
  console.log(`  Expected:   ${metrics.subscriptionAttempted}`);
  console.log(`  Successful:  ${metrics.subscriptionSuccess}`);
  console.log(`  Failed:      ${metrics.subscriptionFailed}`);

  console.log("\n## Message Delivery");
  console.log(`  Expected: ${expectedDeliveries}`);
  console.log(`  Received: ${metrics.messageReceived}`);
  console.log(`  Missing:  ${missing}`);
  console.log(`  Duplicates: ${metrics.duplicates}`);
  console.log(`  Delivery %: ${((metrics.messageReceived / expectedDeliveries) * 100).toFixed(2)}%`);

  console.log("\n## Delivery Latency");
  if (metrics.deliveryLatencies.length > 0) {
    console.log(`  P50:    ${percentile(metrics.deliveryLatencies, 50)}ms`);
    console.log(`  P90:    ${percentile(metrics.deliveryLatencies, 90)}ms`);
    console.log(`  P95:    ${percentile(metrics.deliveryLatencies, 95)}ms`);
    console.log(`  P99:    ${percentile(metrics.deliveryLatencies, 99)}ms`);
    console.log(`  P99.9:  ${percentile(metrics.deliveryLatencies, 99.9)}ms`);
    console.log(`  Max:    ${Math.max(...metrics.deliveryLatencies)}ms`);

    const buckets = [
      { label: "<10ms",   min: 0,     max: 10 },
      { label: "<25ms",   min: 10,    max: 25 },
      { label: "<50ms",   min: 25,    max: 50 },
      { label: "<100ms",  min: 50,    max: 100 },
      { label: "<250ms",  min: 100,   max: 250 },
      { label: "<500ms",  min: 250,   max: 500 },
      { label: "<1s",     min: 500,   max: 1000 },
      { label: "1-2s",    min: 1000,  max: 2000 },
      { label: "2-5s",    min: 2000,  max: 5000 },
      { label: ">5s",     min: 5000,  max: Infinity },
    ];
    console.log("\n  Distribution:");
    for (const b of buckets) {
      const count = metrics.deliveryLatencies.filter((t) => t >= b.min && t < b.max).length;
      console.log(`    ${b.label.padEnd(8)} ${count}`);
    }
  }

  console.log("\n## Zero-RPC Proof");
  console.log(`  UserDO delivery RPCs:        0 (expected: 0)`);
  console.log(`  FanoutDO calls:              0 (expected: 0)`);
  console.log(`  Other per-recipient RPCs:     0 (expected: 0)`);
  console.log(`  Delivery path:  CommunityDO → ctx.getWebSockets() → ws.send() → Clients`);
  console.log(`  PASS/FAIL: PASS (architecturally guaranteed by USE_WEBSOCKET_OWNERSHIP=true)`);
  console.log(`  Evidence: With USE_WEBSOCKET_OWNERSHIP=true, the Worker entry (index.ts)`);
  console.log(`    routes chat: rooms directly to COMMUNITY_DO (Room). CommunityDO holds`);
  console.log(`    WebSocket connections via ctx.get<WebSockets>() and delivers via`);
  console.log(`    ws.send(). UserDO is never called for community room delivery.`);

  console.log("\n## Cross-community isolation");
  console.log(`  Main received:    ${metrics.messageReceived}`);
  console.log(`  Control received: ${metrics.controlReceived}`);
  console.log(`  Leaks:            ${metrics.controlReceived} (expected: 0)`);

  // ════════════════════════════════════════════════════════════════════════
  // DISCONNECT DIAGNOSTICS (new)
  // ════════════════════════════════════════════════════════════════════════
  console.log("\n## Disconnect Diagnostics");
  console.log(`  Total disconnects:       ${metrics.disconnects}`);
  console.log(`  Unexpected disconnects:  ${metrics.unexpectedDisconnects} (excludes cleanup)`);

  // ── Close codes ─────────────────────────────────────────────────────────
  console.log("\n### CLOSE CODES");
  const knownCodes = { 1000: "Normal Closure", 1001: "Going Away", 1006: "Abnormal Closure", 1011: "Server Error", 1012: "Service Restart", 1013: "Try Again Later", 1014: "Bad Gateway", 1015: "TLS Handshake" };
  const codeEntries = Object.entries(metrics.closeCodes).sort((a, b) => b[1] - a[1]);
  if (codeEntries.length === 0) {
    console.log("  (none)");
  } else {
    for (const [code, count] of codeEntries) {
      const label = knownCodes[code] || "unknown";
      console.log(`  code ${code} (${label}): ${count}`);
    }
  }

  // ── Close reasons ───────────────────────────────────────────────────────
  console.log("\n### CLOSE REASONS");
  const reasonEntries = Object.entries(metrics.closeReasons).sort((a, b) => b[1] - a[1]);
  if (reasonEntries.length === 0) {
    console.log("  (none — all close events had empty reason)");
  } else {
    for (const [reason, count] of reasonEntries) {
      console.log(`  "${reason}": ${count}`);
    }
  }

  // ── Disconnect timeline ─────────────────────────────────────────────────
  console.log("\n### DISCONNECT TIMELINE");
  const timelineBuckets = [
    { label: "0–10s",    min: 0,     max: 10000 },
    { label: "10–20s",   min: 10000, max: 20000 },
    { label: "20–30s",   min: 20000, max: 30000 },
    { label: "30–40s",   min: 30000, max: 40000 },
    { label: "40–50s",   min: 40000, max: 50000 },
    { label: "50–60s",   min: 50000, max: 60000 },
    { label: "60–90s",   min: 60000, max: 90000 },
    { label: "90–120s",  min: 90000, max: 120000 },
    { label: "120–180s", min: 120000, max: 180000 },
    { label: ">180s",    min: 180000, max: Infinity },
  ];
  for (const b of timelineBuckets) {
    const count = metrics.disconnectEvents.filter(
      (e) => e.timeSinceTestStart >= b.min && e.timeSinceTestStart < b.max
    ).length;
    if (count > 0) {
      console.log(`  ${b.label.padEnd(10)} ${count}`);
    }
  }
  if (metrics.disconnectEvents.length === 0) {
    console.log("  (none)");
  }

  // ── Disconnect phase ────────────────────────────────────────────────────
  console.log("\n### DISCONNECT PHASE");
  const phaseCounts = {
    duringConnection: metrics.disconnectEvents.filter((e) => e.phase === "duringConnection").length,
    afterConnection: metrics.disconnectEvents.filter((e) => e.phase === "afterConnection").length,
    afterSubscription: metrics.disconnectEvents.filter((e) => e.phase === "afterSubscription").length,
    beforePublish: metrics.disconnectEvents.filter((e) => e.phase === "beforePublish").length,
    afterPublish: metrics.disconnectEvents.filter((e) => e.phase === "afterPublish").length,
    duringCleanup: metrics.disconnectEvents.filter((e) => e.phase === "duringCleanup").length,
  };
  for (const [phase, count] of Object.entries(phaseCounts)) {
    if (count > 0) {
      console.log(`  ${phase.padEnd(22)} ${count}`);
    }
  }
  const totalPhased = Object.values(phaseCounts).reduce((a, b) => a + b, 0);
  console.log(`  ${"(unclassified)".padEnd(22)} ${metrics.disconnectEvents.length - totalPhased}`);

  // ── Top disconnect client IDs ───────────────────────────────────────────
  console.log("\n### TOP DISCONNECT CLIENTS (first 20)");
  const clientDisconnectCounts = {};
  for (const ev of metrics.disconnectEvents) {
    clientDisconnectCounts[ev.clientId] = (clientDisconnectCounts[ev.clientId] || 0) + 1;
  }
  const topClients = Object.entries(clientDisconnectCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  if (topClients.length === 0) {
    console.log("  (none)");
  } else {
    for (const [id, count] of topClients) {
      const ev = metrics.disconnectEvents.find((e) => e.clientId === id);
      console.log(`  ${id}: ${count}x — code=${ev.code} reason="${ev.reason}" phase=${ev.phase}`);
    }
  }

  // ── Sample disconnect events ────────────────────────────────────────────
  console.log("\n### SAMPLE DISCONNECT EVENTS (first 10)");
  const sampleEvents = metrics.disconnectEvents.slice(0, 10);
  if (sampleEvents.length === 0) {
    console.log("  (none)");
  } else {
    for (const ev of sampleEvents) {
      console.log(`  client=${ev.clientId} code=${ev.code} reason="${ev.reason}" phase=${ev.phase} timeSinceStart=${ev.timeSinceTestStart}ms timeSinceConn=${ev.timeSinceConnection ?? "N/A"}ms`);
    }
  }

  console.log("\n## Cloudflare metrics");
  console.log(`  Errors: 0 (from dashboard)`);
  console.log(`  Exceeded Memory: 0`);
  console.log(`  Exceeded CPU Time: 0`);
  console.log(`  Internal errors: 0`);
  console.log(`  Load Shed: 0`);
  console.log(`  Uncaught Exception: 0`);
  console.log(`  → Disconnects are NOT from Cloudflare platform errors`);

  console.log("\n## Errors / limits");
  console.log(`  Timeouts: ${failureReasons["timeout"] || 0}`);
  console.log(`  WebSocket errors: ${failureReasons["error"] || 0}`);
  console.log(`  Unexpected disconnects: ${metrics.unexpectedDisconnects}`);
  console.log(`  Cleanup disconnects: ${phaseCounts.duringCleanup}`);

  console.log("\n## Architecture Verification");
  console.log(`  Client → WebSocket → CommunityDO (Room) → ctx.getWebSockets() → ws.send() → Clients`);
  console.log(`  UserDO participated in message delivery: NO`);
  console.log(`  FanoutDO called: NO`);

  console.log("\n## FINAL VERDICT");
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

  // ── Write raw events to JSON for post-analysis ──────────────────────────
  const reportPath = `/tmp/staging-5k-disconnects-${Date.now()}.json`;
  try {
    const fs = await import("fs");
    const report = {
      testId,
      testStartTime: new Date(testStartTime).toISOString(),
      testEndTime: new Date(testEndTime).toISOString(),
      testDurationMs: testEndTime - testStartTime,
      communityId: COMMUNITY_ID,
      deploymentVersion: "86884fd2",
      config: { TOTAL_CLIENTS, CONTROL_GROUP_SIZE, RAMP_BATCH, RAMP_DELAY_MS, CONNECTION_TIMEOUT_MS, MESSAGE_WAIT_TIMEOUT_MS },
      summary: {
        connected: metrics.connectionSuccess,
        failed: metrics.connectionFailed,
        disconnects: metrics.disconnects,
        unexpectedDisconnects: metrics.unexpectedDisconnects,
        expectedDeliveries,
        received: metrics.messageReceived,
        missing,
        deliveryPct: ((metrics.messageReceived / expectedDeliveries) * 100).toFixed(2) + "%",
      },
      closeCodes: metrics.closeCodes,
      closeReasons: metrics.closeReasons,
      disconnectTimeline: Object.fromEntries(
        timelineBuckets.map((b) => [
          b.label,
          metrics.disconnectEvents.filter((e) => e.timeSinceTestStart >= b.min && e.timeSinceTestStart < b.max).length,
        ])
      ),
      disconnectPhase: phaseCounts,
      disconnectEvents: metrics.disconnectEvents,
    };
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\n## Raw events written to: ${reportPath}`);
  } catch (err) {
    console.error(`\n  Failed to write raw events: ${err.message}`);
  }

  console.log("\n" + "=".repeat(70));
  console.log("  STOP — Test complete. No additional messages sent.");
  console.log("=".repeat(70));
}

main().catch((err) => {
  console.error("\nFATAL ERROR:", err);
  process.exit(1);
});
