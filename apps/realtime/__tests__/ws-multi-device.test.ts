/**
 * Multi-Device / Multi-Tab Tests for CommunityDO WebSocket Ownership
 *
 * Tests that the same user with multiple WebSocket connections (tabs/devices)
 * works correctly — closing one socket does not affect another socket's state.
 *
 * Bug fixed: userTopics was keyed by userId, so second tab overwrote first tab's
 * topics, and closing one tab deleted state for all tabs.
 *
 * Fix: Changed to wsTopics (per-socket) + userSockets (userId → Set<WebSocket>).
 *
 * Run: npx vitest run __tests__/ws-multi-device.test.ts --reporter=verbose
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unstable_dev } from "wrangler";
import type { UnstableDevWorker } from "wrangler";
import WebSocket from "ws";
import { readFileSync } from "fs";
import { resolve } from "path";

const devVars = readFileSync(resolve(__dirname, "../.dev.vars"), "utf-8");
const vars = Object.fromEntries(
  devVars.split("\n").filter(Boolean).map((l) => {
    const [k, ...v] = l.split("=");
    return [k.trim(), v.join("=").trim()];
  })
);
const REALTIME_SECRET = vars.SESSION_SECRET;
const PUBLISH_SECRET = vars.REALTIME_PUBLISH_SECRET;

let worker: UnstableDevWorker;
let baseUrl: string;

async function createToken(userId: string): Promise<string> {
  const { SignJWT } = await import("jose");
  const secret = new TextEncoder().encode(REALTIME_SECRET);
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

function connectCommunityWs(room: string, token: string) {
  const url = `${baseUrl}/ws?room=${encodeURIComponent(room)}&token=${token}`;
  const ws = new WebSocket(url);
  const messages: any[] = [];
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(String(data));
      (msg as any)._recvMs = performance.now();
      messages.push(msg);
    } catch { /* ignore */ }
  });
  return {
    ws,
    messages,
    close: () => { try { ws.close(); } catch { /* ignore */ } },
  };
}

function waitForOpen(ws: WebSocket, ms = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    const t = setTimeout(() => reject(new Error("WS open timeout")), ms);
    ws.on("open", () => { clearTimeout(t); resolve(); });
  });
}

function waitForMessage(
  messages: any[],
  type: string,
  ms = 5000,
  predicate?: (msg: any) => boolean,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const msg = messages.find((m) => m.t === type && (!predicate || predicate(m)));
      if (msg) return resolve(msg);
      if (Date.now() - start > ms) return reject(new Error(`Timeout waiting for ${type}`));
      setTimeout(check, 50);
    };
    check();
  });
}

async function publish(room: string, topic: string, data: unknown, excludeUser?: string) {
  return fetch(`${baseUrl}/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-realtime-publish-secret": PUBLISH_SECRET,
    },
    body: JSON.stringify({ room, topic, data, exclude_user: excludeUser }),
  });
}

async function joinAndSubscribe(
  ws: WebSocket,
  messages: any[],
  userId: string,
  room: string,
  topic: string,
) {
  await waitForOpen(ws);
  ws.send(JSON.stringify({ t: "join", user: { id: userId, name: `User ${userId}`, avatar: null } }));
  await waitForMessage(messages, "hello");
  ws.send(JSON.stringify({ t: "subscribe", room, topic }));
  await new Promise((r) => setTimeout(r, 300));
}

beforeAll(async () => {
  worker = await unstable_dev("src/index.ts", {
    configPath: "wrangler.toml",
    experimentalExcludeMiniflareV1: true,

  });
  baseUrl = `http://127.0.0.1:${worker.port}`;
}, 30_000);

afterAll(async () => {
  await worker?.stop();
});

// ============================================================================
// TEST 1: SAME USER, TWO TABS, BOTH SUBSCRIBED
// ============================================================================

describe("Multi-tab: both tabs receive, close one keeps other alive", () => {
  it("Tab A and Tab B both subscribe, both receive, close A, only B receives", async () => {
    const userId = "multi_tab_user1";
    const room = "chat:ws_comm_mtab1";
    const token = await createToken(userId);

    // Tab A
    const tabA = connectCommunityWs(room, token);
    await joinAndSubscribe(tabA.ws, tabA.messages, userId, room, "chat");

    // Tab B (same user, same room)
    const tabB = connectCommunityWs(room, token);
    await joinAndSubscribe(tabB.ws, tabB.messages, userId, room, "chat");

    // Publish — both should receive
    await publish(room, "chat", { text: "msg1" });
    await new Promise((r) => setTimeout(r, 1000));

    const a1 = tabA.messages.find((m) => m.t === "event" && m.data?.text === "msg1");
    const b1 = tabB.messages.find((m) => m.t === "event" && m.data?.text === "msg1");
    expect(a1).toBeDefined();
    expect(b1).toBeDefined();

    // Close Tab A
    tabA.close();
    await new Promise((r) => setTimeout(r, 500));

    // Publish again — only Tab B should receive
    await publish(room, "chat", { text: "msg2" });
    await new Promise((r) => setTimeout(r, 1000));

    const a2 = tabA.messages.filter((m) => m.t === "event" && m.data?.text === "msg2");
    const b2 = tabB.messages.find((m) => m.t === "event" && m.data?.text === "msg2");
    expect(a2.length).toBe(0); // A is closed, should receive nothing
    expect(b2).toBeDefined(); // B is still open, should receive

    tabB.close();
  });
});

// ============================================================================
// TEST 2: SAME USER, TWO WEBSOCKETS, DIFFERENT TOPICS
// ============================================================================

describe("Multi-tab: different topics on different sockets", () => {
  it("Socket A subscribes chat, Socket B subscribes typing — events route correctly", async () => {
    const userId = "multi_topic_user1";
    const room = "chat:ws_comm_mtopic1";
    const token = await createToken(userId);

    // Socket A — subscribes to chat
    const socketA = connectCommunityWs(room, token);
    await joinAndSubscribe(socketA.ws, socketA.messages, userId, room, "chat");

    // Socket B — subscribes to typing (same user, different topic)
    const socketB = connectCommunityWs(room, token);
    await joinAndSubscribe(socketB.ws, socketB.messages, userId, room, "typing");

    // Publish chat — only A should receive
    await publish(room, "chat", { text: "chat-msg" });
    await new Promise((r) => setTimeout(r, 1000));

    const aChat = socketA.messages.find((m) => m.t === "event" && m.topic === "chat");
    const bChat = socketB.messages.filter((m) => m.t === "event" && m.topic === "chat");
    expect(aChat).toBeDefined();
    expect(bChat.length).toBe(0);

    // Publish typing — only B should receive
    await publish(room, "typing", { typing: true });
    await new Promise((r) => setTimeout(r, 1000));

    const aTyping = socketA.messages.filter((m) => m.t === "event" && m.topic === "typing");
    const bTyping = socketB.messages.find((m) => m.t === "event" && m.topic === "typing");
    expect(aTyping.length).toBe(0);
    expect(bTyping).toBeDefined();

    socketA.close();
    socketB.close();
  });
});

// ============================================================================
// TEST 3: UNSUBSCRIBE ON SOCKET A, SOCKET B REMAINS
// ============================================================================

describe("Multi-tab: unsubscribe on one socket preserves other", () => {
  it("Unsubscribe A — B still receives, A does not", async () => {
    const userId = "multi_unsub_user1";
    const room = "chat:ws_comm_munsub1";
    const token = await createToken(userId);

    const socketA = connectCommunityWs(room, token);
    await joinAndSubscribe(socketA.ws, socketA.messages, userId, room, "chat");

    const socketB = connectCommunityWs(room, token);
    await joinAndSubscribe(socketB.ws, socketB.messages, userId, room, "chat");

    // Both subscribed — publish, both receive
    await publish(room, "chat", { text: "before-unsub" });
    await new Promise((r) => setTimeout(r, 1000));

    const aBefore = socketA.messages.find((m) => m.t === "event" && m.data?.text === "before-unsub");
    const bBefore = socketB.messages.find((m) => m.t === "event" && m.data?.text === "before-unsub");
    expect(aBefore).toBeDefined();
    expect(bBefore).toBeDefined();

    // Unsubscribe Socket A
    socketA.ws.send(JSON.stringify({ t: "unsubscribe", room, topic: "chat" }));
    await new Promise((r) => setTimeout(r, 500));

    // Publish again — only B should receive
    await publish(room, "chat", { text: "after-unsub" });
    await new Promise((r) => setTimeout(r, 1000));

    const aAfter = socketA.messages.filter((m) => m.t === "event" && m.data?.text === "after-unsub");
    const bAfter = socketB.messages.find((m) => m.t === "event" && m.data?.text === "after-unsub");
    expect(aAfter.length).toBe(0);
    expect(bAfter).toBeDefined();

    socketA.close();
    socketB.close();
  });
});

// ============================================================================
// TEST 4: RECONNECT ONE SOCKET, OTHER UNAFFECTED
// ============================================================================

describe("Multi-tab: reconnect one socket, other unaffected", () => {
  it("Disconnect/reconnect Socket A — Socket B must still work", async () => {
    const userId = "multi_recon_user1";
    const room = "chat:ws_comm_mrecon1";
    const token = await createToken(userId);

    // Socket A — first connection
    const socketA1 = connectCommunityWs(room, token);
    await joinAndSubscribe(socketA1.ws, socketA1.messages, userId, room, "chat");

    // Socket B — persistent
    const socketB = connectCommunityWs(room, token);
    await joinAndSubscribe(socketB.ws, socketB.messages, userId, room, "chat");

    // Verify both work
    await publish(room, "chat", { text: "before-recon" });
    await new Promise((r) => setTimeout(r, 1000));

    const a1 = socketA1.messages.find((m) => m.t === "event" && m.data?.text === "before-recon");
    const b1 = socketB.messages.find((m) => m.t === "event" && m.data?.text === "before-recon");
    expect(a1).toBeDefined();
    expect(b1).toBeDefined();

    // Disconnect Socket A
    socketA1.close();
    await new Promise((r) => setTimeout(r, 500));

    // Reconnect Socket A
    const socketA2 = connectCommunityWs(room, token);
    await joinAndSubscribe(socketA2.ws, socketA2.messages, userId, room, "chat");

    // Publish — both should receive
    await publish(room, "chat", { text: "after-recon" });
    await new Promise((r) => setTimeout(r, 1000));

    const b2 = socketB.messages.find((m) => m.t === "event" && m.data?.text === "after-recon");
    const a2 = socketA2.messages.find((m) => m.t === "event" && m.data?.text === "after-recon");
    expect(b2).toBeDefined(); // B never disconnected
    expect(a2).toBeDefined(); // A reconnected and restored

    socketA2.close();
    socketB.close();
  });
});

// ============================================================================
// TEST 5: WEB + MOBILE (TWO INDEPENDENT DEVICES)
// ============================================================================

describe("Multi-device: closing one device does not affect the other", () => {
  it("Two independent clients (simulating web + mobile) — closing one keeps the other alive", async () => {
    const userId = "multi_device_user1";
    const room = "chat:ws_comm_mdev1";
    const token = await createToken(userId);

    // Device 1 (web)
    const device1 = connectCommunityWs(room, token);
    await joinAndSubscribe(device1.ws, device1.messages, userId, room, "chat");

    // Device 2 (mobile)
    const device2 = connectCommunityWs(room, token);
    await joinAndSubscribe(device2.ws, device2.messages, userId, room, "chat");

    // Both receive
    await publish(room, "chat", { text: "device-test" });
    await new Promise((r) => setTimeout(r, 1000));

    const d1 = device1.messages.find((m) => m.t === "event" && m.data?.text === "device-test");
    const d2 = device2.messages.find((m) => m.t === "event" && m.data?.text === "device-test");
    expect(d1).toBeDefined();
    expect(d2).toBeDefined();

    // Close device 1 (web app closed)
    device1.close();
    await new Promise((r) => setTimeout(r, 500));

    // Device 2 (mobile) must still receive
    await publish(room, "chat", { text: "mobile-only" });
    await new Promise((r) => setTimeout(r, 1000));

    const d1after = device1.messages.filter((m) => m.t === "event" && m.data?.text === "mobile-only");
    const d2after = device2.messages.find((m) => m.t === "event" && m.data?.text === "mobile-only");
    expect(d1after.length).toBe(0);
    expect(d2after).toBeDefined();

    device2.close();
  });
});

// ============================================================================
// TEST 6: THREE TABS — CLOSE MIDDLE ONE
// ============================================================================

describe("Multi-tab: three tabs, close middle one", () => {
  it("Tab A, B, C all subscribe. Close B. A and C still receive.", async () => {
    const userId = "multi_3tab_user1";
    const room = "chat:ws_comm_3tab1";
    const token = await createToken(userId);

    const tabA = connectCommunityWs(room, token);
    await joinAndSubscribe(tabA.ws, tabA.messages, userId, room, "chat");

    const tabB = connectCommunityWs(room, token);
    await joinAndSubscribe(tabB.ws, tabB.messages, userId, room, "chat");

    const tabC = connectCommunityWs(room, token);
    await joinAndSubscribe(tabC.ws, tabC.messages, userId, room, "chat");

    // All three receive
    await publish(room, "chat", { text: "3tab-msg1" });
    await new Promise((r) => setTimeout(r, 1000));

    expect(tabA.messages.find((m) => m.t === "event" && m.data?.text === "3tab-msg1")).toBeDefined();
    expect(tabB.messages.find((m) => m.t === "event" && m.data?.text === "3tab-msg1")).toBeDefined();
    expect(tabC.messages.find((m) => m.t === "event" && m.data?.text === "3tab-msg1")).toBeDefined();

    // Close Tab B
    tabB.close();
    await new Promise((r) => setTimeout(r, 500));

    // Publish again — A and C should receive, B should not
    await publish(room, "chat", { text: "3tab-msg2" });
    await new Promise((r) => setTimeout(r, 1000));

    expect(tabA.messages.find((m) => m.t === "event" && m.data?.text === "3tab-msg2")).toBeDefined();
    expect(tabB.messages.filter((m) => m.t === "event" && m.data?.text === "3tab-msg2").length).toBe(0);
    expect(tabC.messages.find((m) => m.t === "event" && m.data?.text === "3tab-msg2")).toBeDefined();

    tabA.close();
    tabC.close();
  });
});

// ============================================================================
// TEST 7: SAME USER, MIXED TOPICS ACROSS 3 SOCKETS
// ============================================================================

describe("Multi-tab: mixed topics across 3 sockets of same user", () => {
  it("Socket A: chat, Socket B: typing, Socket C: chat+typing — correct routing", async () => {
    const userId = "multi_mixed_user1";
    const room = "chat:ws_comm_mixed1";
    const token = await createToken(userId);

    // Socket A — chat only
    const socketA = connectCommunityWs(room, token);
    await joinAndSubscribe(socketA.ws, socketA.messages, userId, room, "chat");

    // Socket B — typing only
    const socketB = connectCommunityWs(room, token);
    await joinAndSubscribe(socketB.ws, socketB.messages, userId, room, "typing");

    // Socket C — chat + typing
    const socketC = connectCommunityWs(room, token);
    await joinAndSubscribe(socketC.ws, socketC.messages, userId, room, "chat");
    socketC.ws.send(JSON.stringify({ t: "subscribe", room, topic: "typing" }));
    await new Promise((r) => setTimeout(r, 300));

    // Publish chat — A and C should receive, B should not
    await publish(room, "chat", { text: "chat-event" });
    await new Promise((r) => setTimeout(r, 1000));

    expect(socketA.messages.find((m) => m.t === "event" && m.topic === "chat" && m.data?.text === "chat-event")).toBeDefined();
    expect(socketB.messages.filter((m) => m.t === "event" && m.topic === "chat").length).toBe(0);
    expect(socketC.messages.find((m) => m.t === "event" && m.topic === "chat" && m.data?.text === "chat-event")).toBeDefined();

    // Publish typing — B and C should receive, A should not
    await publish(room, "typing", { typing: true });
    await new Promise((r) => setTimeout(r, 1000));

    expect(socketA.messages.filter((m) => m.t === "event" && m.topic === "typing").length).toBe(0);
    expect(socketB.messages.find((m) => m.t === "event" && m.topic === "typing")).toBeDefined();
    expect(socketC.messages.find((m) => m.t === "event" && m.topic === "typing")).toBeDefined();

    // Close socket C — A and B must still work
    socketC.close();
    await new Promise((r) => setTimeout(r, 500));

    await publish(room, "chat", { text: "after-close-c" });
    await new Promise((r) => setTimeout(r, 1000));

    expect(socketA.messages.find((m) => m.t === "event" && m.topic === "chat" && m.data?.text === "after-close-c")).toBeDefined();
    expect(socketC.messages.filter((m) => m.t === "event" && m.data?.text === "after-close-c").length).toBe(0);

    await publish(room, "typing", { typing: false });
    await new Promise((r) => setTimeout(r, 1000));

    expect(socketB.messages.find((m) => m.t === "event" && m.topic === "typing" && m.data?.typing === false)).toBeDefined();

    socketA.close();
    socketB.close();
  });
});
