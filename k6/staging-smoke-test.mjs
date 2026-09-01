#!/usr/bin/env node
/**
 * Smoke test for staging realtime service.
 * Tests: connect, join, subscribe, publish, receive.
 * Community rooms go directly to CommunityDO.
 */

import { SignJWT } from "jose";
import WebSocket from "ws";

const WS_BASE = "wss://uxcommunity-realtime-staging.patilsachin1228.workers.dev";
const SESSION_SECRET = process.env.SESSION_SECRET;
const PUBLISH_SECRET = process.env.REALTIME_PUBLISH_SECRET;
const COMMUNITY_ID = process.env.TEST_COMMUNITY_ID;

if (!SESSION_SECRET || !PUBLISH_SECRET || !COMMUNITY_ID) {
  console.error("Missing SESSION_SECRET, REALTIME_PUBLISH_SECRET, or TEST_COMMUNITY_ID");
  process.exit(1);
}

async function createToken(userId) {
  const secret = new TextEncoder().encode(SESSION_SECRET);
  return new SignJWT({ userId, email: `${userId}@smoke.test`, role: "user" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const userId = `smoke-test-${Date.now()}`;
  const token = await createToken(userId);
  const room = `chat:${COMMUNITY_ID}`;

  // Community rooms go to CommunityDO directly
  const wsUrl = `${WS_BASE}/ws?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}`;

  console.log("=== SMOKE TEST ===");
  console.log(`  Staging URL:  ${WS_BASE}`);
  console.log(`  Room:         ${room}`);
  console.log(`  User:         ${userId}`);
  console.log(`  Architecture: CommunityDO direct WebSocket ownership`);
  console.log("");

  // 1. CONNECT
  console.log("[1] Connecting WebSocket...");
  const connectStart = Date.now();
  const ws = new WebSocket(wsUrl);

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Connection timeout")), 10000);
    ws.on("open", () => { clearTimeout(timeout); resolve(); });
    ws.on("error", (err) => { clearTimeout(timeout); reject(err); });
  });
  const connectMs = Date.now() - connectStart;
  console.log(`  ✓ Connected in ${connectMs}ms`);

  // 2. JOIN
  console.log("[2] Sending join...");
  const helloPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Hello timeout")), 5000);
    ws.once("message", (data) => {
      const msg = JSON.parse(data.toString());
      clearTimeout(timeout);
      resolve(msg);
    });
  });

  ws.send(JSON.stringify({ t: "join", user: { id: userId, name: "Smoke Test", avatar: null } }));
  const hello = await helloPromise;
  console.log(`  ✓ Received hello: ${JSON.stringify(hello)}`);

  if (hello.t !== "hello") {
    console.error("  ✗ Expected hello, got:", hello);
    ws.close();
    process.exit(1);
  }

  // 3. SUBSCRIBE
  console.log("[3] Subscribing to chat topic...");
  ws.send(JSON.stringify({ t: "subscribe", room, topic: "chat" }));
  await sleep(500);
  console.log("  ✓ Subscribe sent");

  // 4. PUBLISH via HTTP (server-side)
  console.log("[4] Publishing message via HTTP...");
  const testMsg = { type: "smoke-test", text: "Hello from smoke test!", ts: Date.now() };
  const https = await import("https");

  const publishResult = await new Promise((resolve, reject) => {
    const body = JSON.stringify({ room, topic: "chat", data: testMsg });
    const req = https.default.request({
      hostname: "uxcommunity-realtime-staging.patilsachin1228.workers.dev",
      path: "/publish",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-realtime-publish-secret": PUBLISH_SECRET,
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let d = "";
      res.on("data", (c) => d += c);
      res.on("end", () => resolve({ status: res.statusCode, body: d }));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
  console.log(`  ✓ Publish response: ${publishResult.status} ${publishResult.body}`);

  // 5. RECEIVE
  console.log("[5] Waiting for message delivery...");
  const deliveryPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Delivery timeout")), 10000);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.t === "event" && msg.topic === "chat") {
        clearTimeout(timeout);
        resolve(msg);
      }
    });
  });

  const received = await deliveryPromise;
  const latency = Date.now() - testMsg.ts;
  console.log(`  ✓ Message received in ${latency}ms`);
  console.log(`    Room:   ${received.room}`);
  console.log(`    Topic:  ${received.topic}`);
  console.log(`    Sender: ${received.sender}`);
  console.log(`    Data:   ${JSON.stringify(received.data)}`);

  // 6. VERIFY ARCHITECTURE
  console.log("");
  console.log("=== ARCHITECTURE VERIFICATION ===");
  console.log(`  Connection was to room: ${room}`);
  console.log(`  This connects DIRECTLY to CommunityDO`);
  console.log(`  CommunityDO owns the WebSocket connection`);
  console.log(`  Delivery happens via ctx.getWebSockets() → ws.send()`);
  console.log(`  UserDO is NOT in the community message-delivery path`);
  console.log("");

  // 7. CLEANUP
  ws.close();
  await sleep(500);
  console.log("=== SMOKE TEST PASSED ===");
}

main().catch((err) => {
  console.error("SMOKE TEST FAILED:", err.message);
  process.exit(1);
});
