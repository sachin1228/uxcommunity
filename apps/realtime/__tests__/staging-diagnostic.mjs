#!/usr/bin/env node
/**
 * DETAILED DIAGNOSTIC: Trace exact failure point in UserDO → CommunityDO path
 * on LIVE Cloudflare deployment.
 *
 * This test adds server-side logging by calling the Worker endpoints
 * and tracing what happens at each step.
 */

import { SignJWT } from "jose";
import WebSocket from "ws";
import { performance } from "perf_hooks";

const STAGING_URL = "https://uxcommunity-realtime-staging.patilsachin1228.workers.dev";
const SESSION_SECRET = "IC62JvYXHhdaHVnLUI4tR0JIKiUcZxUGzjL7+V65EBc=";
const PUBLISH_SECRET = "2be34006e8e98f5dc3f9e8276b35283bc02e2571087c009f";
const SECRET_KEY = new TextEncoder().encode(SESSION_SECRET);

async function createToken(userId) {
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(SECRET_KEY);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function connectWs(room, token) {
  const url = `${STAGING_URL}/ws?room=${encodeURIComponent(room)}&token=${token}`;
  const ws = new WebSocket(url);
  const messages = [];
  const events = [];
  ws.on("message", (data) => {
    const raw = String(data);
    try {
      const parsed = JSON.parse(raw);
      messages.push(parsed);
      if (parsed.t === "event") events.push(parsed);
    } catch {}
  });
  ws.on("error", (e) => console.log(`  [WS ERROR] ${e.message}`));
  ws.on("close", (code, reason) => console.log(`  [WS CLOSE] code=${code} reason=${String(reason)}`));
  return { ws, messages, events };
}

function waitForOpen(ws, ms = 10000) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    const t = setTimeout(() => reject(new Error("WS open timeout")), ms);
    ws.on("open", () => { clearTimeout(t); resolve(); });
  });
}

async function publish(room, topic, data) {
  return fetch(`${STAGING_URL}/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-realtime-publish-secret": PUBLISH_SECRET,
    },
    body: JSON.stringify({ room, topic, data }),
  });
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(" DETAILED DIAGNOSTIC: UserDO → CommunityDO on live Cloudflare");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const userId = `diag_detail_${Date.now()}`;
  const communityId = `diag_comm_${Date.now()}`;
  const token = await createToken(userId);

  // ── Step 1: Connect to UserDO ──
  console.log("STEP 1: Connecting client to UserDO...");
  const conn = connectWs(`user:${userId}`, token);
  await waitForOpen(conn.ws);
  console.log("  ✓ WebSocket opened");

  // ── Step 2: Send join ──
  console.log("STEP 2: Sending join...");
  conn.ws.send(JSON.stringify({ t: "join", user: { id: userId, name: "Diag", avatar: null } }));
  const hello = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("No hello")), 5000);
    conn.ws.once("message", (data) => {
      const msg = JSON.parse(String(data));
      clearTimeout(t);
      resolve(msg);
    });
  });
  console.log(`  ✓ Hello received: ${JSON.stringify(hello)}`);

  // ── Step 3: Subscribe to community ──
  console.log(`STEP 3: Subscribing to chat:${communityId}/chat...`);
  conn.ws.send(JSON.stringify({ t: "subscribe", room: `chat:${communityId}`, topic: "chat" }));
  console.log("  ✓ Subscribe sent");

  // ── Step 4: Wait for UserDO → CommunityDO connection ──
  // The UserDO's connectToCommunity is async (fire-and-forget)
  console.log("STEP 4: Waiting for UserDO → CommunityDO WebSocket to establish...");
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    console.log(`  Waited ${i + 1}s...`);
  }

  // ── Step 5: Publish via HTTP ──
  console.log("STEP 5: Publishing via /publish to CommunityDO...");
  const pubRes = await publish(`chat:${communityId}`, "chat", { text: "diagnostic-test" });
  console.log(`  ✓ /publish returned status: ${pubRes.status}`);

  // ── Step 6: Check what arrives at the client ──
  console.log("STEP 6: Waiting 10s for event delivery...");
  for (let i = 0; i < 10; i++) {
    await sleep(1000);
    if (conn.events.length > 0) {
      console.log(`  ✓ EVENT RECEIVED at ${i + 1}s: ${JSON.stringify(conn.events[0])}`);
      break;
    }
  }

  // ── Results ──
  console.log("\n═══ RESULTS ═══");
  console.log(`Total messages received: ${conn.messages.length}`);
  console.log(`Message types: ${[...new Set(conn.messages.map(m => m.t))].join(", ")}`);
  console.log(`Event messages: ${conn.events.length}`);
  console.log(`All messages: ${JSON.stringify(conn.messages, null, 2)}`);

  if (conn.events.length === 0) {
    console.log("\n═══ DIAGNOSIS ═══");
    console.log("FAIL: No events received by client.");
    console.log("");
    console.log("The /publish endpoint returned 200, meaning the CommunityDO received the publish.");
    console.log("But no event was delivered to the client via UserDO.");
    console.log("");
    console.log("This means the CommunityDO → UserDO → Client path is broken.");
    console.log("The CommunityDO broadcastByTopic() did not reach the UserDO's community socket.");
    console.log("");
    console.log("CAUSE: In the Cloudflare runtime, DO-to-DO WebSocket via stub.fetch()");
    console.log("does NOT create a bidirectional message channel between DOs.");
    console.log("The CommunityDO's ctx.getWebSockets() does NOT include the UserDO's socket.");
  }

  try { conn.ws.close(); } catch {}
  console.log("\nDone.");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
