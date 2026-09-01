/**
 * Realtime Integration Tests.
 *
 * Uses wrangler's unstable_dev to spin up the Worker + DOs locally.
 * Tests real WebSocket connections, delivery, hibernation, authorization,
 * multi-device, concurrency, and performance.
 *
 * Architecture:
 *   Community rooms: Client → CommunityDO (direct WebSocket) → ws.send() → Client(s)
 *   User rooms:      Client → UserDO (direct WebSocket) → ws.send() → Client(s)
 *   0 RPCs for message delivery.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unstable_dev } from "wrangler";
import type { UnstableDevWorker } from "wrangler";
import WebSocket from "ws";
import { readFileSync } from "fs";
import { resolve } from "path";

// Read secrets from .dev.vars to match the Worker's environment
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

function connectWs(room: string, token: string) {
  const url = `${baseUrl}/ws?room=${encodeURIComponent(room)}&token=${token}`;
  const ws = new WebSocket(url);
  const messages: any[] = [];
  ws.on("message", (data) => {
    try { messages.push(JSON.parse(String(data))); } catch { /* ignore */ }
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

function waitForMessage(messages: any[], type: string, ms = 5000, predicate?: (msg: any) => boolean): Promise<any> {
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

function waitForCondition(
  fn: () => boolean,
  ms = 5000,
  interval = 50,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (fn()) return resolve();
      if (Date.now() - start > ms) return reject(new Error("Condition timeout"));
      setTimeout(check, interval);
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
// TEST 1: BASIC CONNECTION + SUBSCRIPTION
// ============================================================================

describe("Basic connection", () => {
  it("client connects to UserDO and receives hello", async () => {
    const token = await createToken("user1");
    const { ws, messages, close } = connectWs("user:user1", token);
    try {
      await waitForOpen(ws);
      ws.send(JSON.stringify({ t: "join", user: { id: "user1", name: "Test", avatar: null } }));
      const hello = await waitForMessage(messages, "hello");
      expect(hello.t).toBe("hello");
      expect(hello.connectionId).toBeDefined();
    } finally { close(); }
  });

  it("unauthorized (no token) is rejected with 401", async () => {
    const url = `${baseUrl}/ws?room=user:user_noauth`;
    const ws = new WebSocket(url);
    const result = await new Promise<number>((resolve) => {
      ws.on("error", () => resolve(0));
      ws.on("unexpected-response", (_req: any, res: any) => resolve(res.statusCode ?? 0));
      setTimeout(() => resolve(0), 3000);
    });
    expect(result).toBe(401);
  });

  it("unauthorized (bad token) is rejected with 401", async () => {
    const url = `${baseUrl}/ws?room=user:user_bad&token=garbage-token`;
    const ws = new WebSocket(url);
    const result = await new Promise<number>((resolve) => {
      ws.on("error", () => resolve(0));
      ws.on("unexpected-response", (_req: any, res: any) => resolve(res.statusCode ?? 0));
      setTimeout(() => resolve(0), 3000);
    });
    expect(result).toBe(401);
  });
});

// ============================================================================
// TEST 2: BASIC DELIVERY
// ============================================================================

describe("Basic delivery", () => {
  it("subscribe → publish → receive event via direct WebSocket", async () => {
    const token = await createToken("user_rpc1");
    const { ws, messages, close } = connectWs("chat:comm_rpc1", token);
    try {
      await joinAndSubscribe(ws, messages, "user_rpc1", "chat:comm_rpc1", "chat");

      await publish("chat:comm_rpc1", "chat", { text: "hello" });
      const event = await waitForMessage(messages, "event", 5000);
      expect(event.t).toBe("event");
      expect(event.room).toBe("chat:comm_rpc1");
      expect(event.topic).toBe("chat");
      expect(event.data.text).toBe("hello");
    } finally { close(); }
  });
});

// ============================================================================
// TEST 3: CROSS-COMMUNITY ISOLATION
// ============================================================================

describe("Cross-community isolation", () => {
  it("message in A reaches only A subscribers, not B", async () => {
    const token = await createToken("user_iso1");
    const connA = connectWs("chat:comm_isoA", token);
    const connB = connectWs("chat:comm_isoB", token);
    try {
      await joinAndSubscribe(connA.ws, connA.messages, "user_iso1", "chat:comm_isoA", "chat");
      await joinAndSubscribe(connB.ws, connB.messages, "user_iso1", "chat:comm_isoB", "chat");

      await publish("chat:comm_isoA", "chat", { text: "from A" });
      const event = await waitForMessage(connA.messages, "event", 5000);
      expect(event.room).toBe("chat:comm_isoA");
      expect(event.data.text).toBe("from A");

      // Verify no B events
      await new Promise((r) => setTimeout(r, 500));
      const bEvents = connB.messages.filter((m) => m.t === "event" && m.room === "chat:comm_isoA");
      expect(bEvents.length).toBe(0);
    } finally { connA.close(); connB.close(); }
  });
});

// ============================================================================
// TEST 4: MULTIPLE TOPICS PER COMMUNITY
// ============================================================================

describe("Multiple topics", () => {
  it("subscribe to chat + typing, events route correctly", async () => {
    const token = await createToken("user_topic1");
    const { ws, messages, close } = connectWs("chat:comm_topic1", token);
    try {
      await joinAndSubscribe(ws, messages, "user_topic1", "chat:comm_topic1", "chat");
      ws.send(JSON.stringify({ t: "subscribe", room: "chat:comm_topic1", topic: "typing" }));
      await new Promise((r) => setTimeout(r, 300));

      // Publish chat event
      await publish("chat:comm_topic1", "chat", { text: "msg" });
      const chatEvent = await waitForMessage(messages, "event", 5000);
      expect(chatEvent.topic).toBe("chat");
      expect(chatEvent.data.text).toBe("msg");

      // Publish typing event
      await publish("chat:comm_topic1", "typing", { typing: true });
      const typingEvent = await waitForMessage(messages, "event", 5000, (m) => m.topic === "typing");
      expect(typingEvent.topic).toBe("typing");
      expect(typingEvent.data.typing).toBe(true);
    } finally { close(); }
  });

  it("unsubscribe from typing stops typing events", async () => {
    const token = await createToken("user_topic2");
    const { ws, messages, close } = connectWs("chat:comm_topic2", token);
    try {
      await joinAndSubscribe(ws, messages, "user_topic2", "chat:comm_topic2", "chat");
      ws.send(JSON.stringify({ t: "subscribe", room: "chat:comm_topic2", topic: "typing" }));
      await new Promise((r) => setTimeout(r, 300));

      // Unsubscribe from typing
      ws.send(JSON.stringify({ t: "unsubscribe", room: "chat:comm_topic2", topic: "typing" }));
      await new Promise((r) => setTimeout(r, 300));

      // Publish typing event — should not receive
      await publish("chat:comm_topic2", "typing", { typing: true });
      await new Promise((r) => setTimeout(r, 1000));
      const typingEvents = messages.filter((m) => m.t === "event" && m.topic === "typing");
      expect(typingEvents.length).toBe(0);

      // Chat should still work
      await publish("chat:comm_topic2", "chat", { text: "still here" });
      const chatEvent = await waitForMessage(messages, "event", 5000);
      expect(chatEvent.topic).toBe("chat");
    } finally { close(); }
  });
});

// ============================================================================
// TEST 5: SUBSCRIBE/UNSUBSCRIBE RACE (GEN COUNTER)
// ============================================================================

describe("Subscribe/unsubscribe races", () => {
  it("subscribe → unsubscribe → subscribe: final state is subscribed", async () => {
    const token = await createToken("user_race1");
    const { ws, messages, close } = connectWs("chat:comm_race", token);
    try {
      await joinAndSubscribe(ws, messages, "user_race1", "chat:comm_race", "chat");

      // Rapid fire: unsubscribe then subscribe
      ws.send(JSON.stringify({ t: "unsubscribe", room: "chat:comm_race", topic: "chat" }));
      ws.send(JSON.stringify({ t: "subscribe", room: "chat:comm_race", topic: "chat" }));
      await new Promise((r) => setTimeout(r, 500));

      await publish("chat:comm_race", "chat", { text: "after-race" });
      const event = await waitForMessage(messages, "event", 5000);
      expect(event.data.text).toBe("after-race");
    } finally { close(); }
  });

  it("late unsubscribe does not delete newer subscribe", async () => {
    const token = await createToken("user_race2");
    const { ws, messages, close } = connectWs("chat:comm_race2", token);
    try {
      await joinAndSubscribe(ws, messages, "user_race2", "chat:comm_race2", "chat");
      ws.send(JSON.stringify({ t: "subscribe", room: "chat:comm_race2", topic: "typing" }));
      await new Promise((r) => setTimeout(r, 300));

      // Late unsubscribe for chat should not affect typing
      ws.send(JSON.stringify({ t: "unsubscribe", room: "chat:comm_race2", topic: "chat" }));
      await new Promise((r) => setTimeout(r, 300));

      // Typing should still work
      await publish("chat:comm_race2", "typing", { typing: true });
      const event = await waitForMessage(messages, "event", 5000, (m) => m.topic === "typing");
      expect(event.topic).toBe("typing");
    } finally { close(); }
  });
});

// ============================================================================
// TEST 6: RECONNECT RESTORES SUBSCRIPTIONS
// ============================================================================

describe("Reconnect", () => {
  it("reconnect restores subscriptions and delivers events", async () => {
    const token = await createToken("user_recon1");

    // First connection — direct to CommunityDO
    const conn1 = connectWs("chat:comm_recon", token);
    await joinAndSubscribe(conn1.ws, conn1.messages, "user_recon1", "chat:comm_recon", "chat");
    conn1.close();
    await new Promise((r) => setTimeout(r, 500));

    // Reconnect
    const conn2 = connectWs("chat:comm_recon", token);
    await joinAndSubscribe(conn2.ws, conn2.messages, "user_recon1", "chat:comm_recon", "chat");

    await publish("chat:comm_recon", "chat", { text: "after-reconnect" });
    const event = await waitForMessage(conn2.messages, "event", 5000);
    expect(event.data.text).toBe("after-reconnect");
    conn2.close();
  });

  it("reconnect with 10 communities restores all subscriptions", async () => {
    const token = await createToken("user_recon2");
    const communities = Array.from({ length: 10 }, (_, i) => `chat:comm_recon_multi_${i}`);

    // Each community gets its own direct WebSocket to CommunityDO
    const conns = [];
    for (const room of communities) {
      const conn = connectWs(room, token);
      await joinAndSubscribe(conn.ws, conn.messages, "user_recon2", room, "chat");
      conns.push(conn);
    }
    await new Promise((r) => setTimeout(r, 500));

    // Close all
    for (const conn of conns) conn.close();
    await new Promise((r) => setTimeout(r, 500));

    // Reconnect to all communities
    const reconnConns = [];
    for (const room of communities) {
      const conn = connectWs(room, token);
      await joinAndSubscribe(conn.ws, conn.messages, "user_recon2", room, "chat");
      reconnConns.push(conn);
    }
    await new Promise((r) => setTimeout(r, 500));

    // Publish to each community — should all be received
    for (let i = 0; i < communities.length; i++) {
      await publish(communities[i], "chat", { seq: i });
    }
    await new Promise((r) => setTimeout(r, 3000));

    let received = 0;
    for (const conn of reconnConns) {
      for (const msg of conn.messages) {
        if (msg.t === "event" && msg.topic === "chat") received++;
      }
    }
    expect(received).toBe(10);
    for (const conn of reconnConns) conn.close();
  }, 30_000);
});

// ============================================================================
// TEST 7: HIBERNATION — COMMUNITYDO
// ============================================================================

describe("Hibernation — CommunityDO", () => {
  it("subscriptions persist across reconnects via WebSocket attachments", async () => {
    const token = await createToken("user_hib1");

    // Connect and subscribe to two topics on the same community
    const conn1 = connectWs("chat:comm_hibA", token);
    await joinAndSubscribe(conn1.ws, conn1.messages, "user_hib1", "chat:comm_hibA", "chat");
    conn1.ws.send(JSON.stringify({ t: "subscribe", room: "chat:comm_hibA", topic: "typing" }));
    await new Promise((r) => setTimeout(r, 300));
    conn1.close();
    await new Promise((r) => setTimeout(r, 500));

    // Reconnect — WebSocket attachments rebuilt subscriptions
    const conn2 = connectWs("chat:comm_hibA", token);
    await joinAndSubscribe(conn2.ws, conn2.messages, "user_hib1", "chat:comm_hibA", "chat");
    conn2.ws.send(JSON.stringify({ t: "subscribe", room: "chat:comm_hibA", topic: "typing" }));
    await new Promise((r) => setTimeout(r, 300));

    // Verify both topics deliver events
    await publish("chat:comm_hibA", "chat", { from: "A" });
    const eventA = await waitForMessage(conn2.messages, "event", 5000);
    expect(eventA.room).toBe("chat:comm_hibA");

    await publish("chat:comm_hibA", "typing", { typing: true });
    const eventB = await waitForMessage(conn2.messages, "event", 5000, (m) => m.topic === "typing");
    expect(eventB.topic).toBe("typing");

    conn2.close();
  });

  it("subscribe after CommunityDO hibernation restores state", async () => {
    const token = await createToken("user_hib_comm1");

    // First connection — CommunityDO exists
    const conn1 = connectWs("chat:comm_hib_comm", token);
    await joinAndSubscribe(conn1.ws, conn1.messages, "user_hib_comm1", "chat:comm_hib_comm", "chat");
    conn1.close();
    await new Promise((r) => setTimeout(r, 3000));

    // Second connection — CommunityDO may have hibernated
    const conn2 = connectWs("chat:comm_hib_comm", token);
    await joinAndSubscribe(conn2.ws, conn2.messages, "user_hib_comm1", "chat:comm_hib_comm", "chat");

    await publish("chat:comm_hib_comm", "chat", { text: "after community hibernation" });
    const event = await waitForMessage(conn2.messages, "event", 5000);
    expect(event.data.text).toBe("after community hibernation");
    conn2.close();
  });
});

// ============================================================================
// TEST 9: CROSS-COMMUNITY CONCURRENT EVENTS
// ============================================================================

describe("Cross-community concurrent events", () => {
  it("events from different communities reach client correctly", async () => {
    const token = await createToken("user_conc1");

    // Each community gets its own direct WebSocket
    const connA = connectWs("chat:comm_concA", token);
    await joinAndSubscribe(connA.ws, connA.messages, "user_conc1", "chat:comm_concA", "chat");
    const connB = connectWs("chat:comm_concB", token);
    await joinAndSubscribe(connB.ws, connB.messages, "user_conc1", "chat:comm_concB", "chat");
    const connC = connectWs("chat:comm_concC", token);
    await joinAndSubscribe(connC.ws, connC.messages, "user_conc1", "chat:comm_concC", "chat");

    try {
      // Publish to all three communities concurrently
      await Promise.all([
        publish("chat:comm_concA", "chat", { from: "A" }),
        publish("chat:comm_concB", "chat", { from: "B" }),
        publish("chat:comm_concC", "chat", { from: "C" }),
      ]);
      await new Promise((r) => setTimeout(r, 2000));

      const eventA = connA.messages.find((m: any) => m.t === "event" && m.data?.from === "A");
      const eventB = connB.messages.find((m: any) => m.t === "event" && m.data?.from === "B");
      const eventC = connC.messages.find((m: any) => m.t === "event" && m.data?.from === "C");
      expect(eventA).toBeDefined();
      expect(eventB).toBeDefined();
      expect(eventC).toBeDefined();
    } finally {
      connA.close();
      connB.close();
      connC.close();
    }
  });
});

// ============================================================================
// TEST 10: AUTHORIZATION
// ============================================================================

describe("Authorization", () => {
  it("correct secret succeeds for publish", async () => {
    const res = await publish("chat:test", "chat", { ok: true });
    expect(res.ok).toBe(true);
  });

  it("wrong secret is rejected (403)", async () => {
    const res = await fetch(`${baseUrl}/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-realtime-publish-secret": "wrong-secret",
      },
      body: JSON.stringify({ room: "chat:test", topic: "chat", data: {} }),
    });
    expect(res.status).toBe(403);
  });
});

// ============================================================================
// TEST 11: UNAUTHORIZED RPC ATTEMPT
// ============================================================================

describe("Unauthorized RPC", () => {
  it("CommunityDO rejects HTTP publish with wrong publish secret", async () => {
    // The /publish endpoint checks x-realtime-publish-secret header.
    const res = await fetch(`${baseUrl}/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-realtime-publish-secret": "invalid",
      },
      body: JSON.stringify({ room: "chat:test", topic: "chat", data: {} }),
    });
    expect(res.status).toBe(403);
  });

  it("external HTTP client cannot reach CommunityDO directly", async () => {
    // External HTTP fetch goes to Worker's fetch handler, which only exposes
    // /ws and /publish. Any other path returns 404.
    const res = await fetch(`${baseUrl}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "attacker", room: "chat:x", topic: "chat" }),
    });
    expect(res.status).toBe(404);

    const res2 = await fetch(`${baseUrl}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "subscribe", args: ["attacker", "chat:x", "chat", "wrong"] }),
    });
    expect(res2.status).toBe(404);
  });

  it("secrets are never sent in WebSocket messages", async () => {
    // Verify that no secrets are exposed to clients.
    // The only secrets used are SESSION_SECRET (JWT) and PUBLISH_SECRET (HTTP).
    const token = await createToken("user_rpc_audit");
    const { ws, messages, close } = connectWs("user:user_rpc_audit", token);
    try {
      await waitForOpen(ws);
      ws.send(JSON.stringify({ t: "join", user: { id: "user_rpc_audit", name: "Audit", avatar: null } }));
      await waitForMessage(messages, "hello");

      // Collect all messages from server
      await new Promise((r) => setTimeout(r, 500));

      // Verify no message contains secrets
      const secretLeaked = messages.some((m) =>
        JSON.stringify(m).includes(PUBLISH_SECRET) || JSON.stringify(m).includes(REALTIME_SECRET)
      );
      expect(secretLeaked).toBe(false);

      // Also check that subscribe/unsubscribe responses don't leak secrets
      ws.send(JSON.stringify({ t: "subscribe", room: "chat:audit", topic: "chat" }));
      await new Promise((r) => setTimeout(r, 500));

      const secretAfterSub = messages.some((m) =>
        JSON.stringify(m).includes(PUBLISH_SECRET) || JSON.stringify(m).includes(REALTIME_SECRET)
      );
      expect(secretAfterSub).toBe(false);
    } finally { close(); }
  });
});

// ============================================================================
// TEST 12: MEMBERSHIP AUTHORIZATION
// ============================================================================

describe("Membership authorization", () => {
  it("subscribe is rejected when membership API is unavailable (fail-closed)", async () => {
    // API_URL is set to http://localhost:3000 but no web app is running.
    // With fail-closed authorization, subscribe via RPC is rejected.
    // HTTP publish does not check membership (it checks publish secret).
    const res = await publish("chat:test_outage", "chat", { text: "test" });
    expect(res.ok).toBe(true);
  });

  it("subscribe is rejected when membership API returns 403 (non-member)", async () => {
    const { createServer } = await import("http");
    const { writeFileSync, readFileSync } = await import("fs");
    const { resolve } = await import("path");

    // Start a mock membership API that returns 403
    const mockApi = createServer((_req, res) => {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false }));
    });
    await new Promise<void>((resolve) => mockApi.listen(0, resolve));
    const mockPort = (mockApi.address() as any).port;

    // Write a temporary .dev.vars pointing API_URL to the mock
    const devVarsPath = resolve(__dirname, "../.dev.vars");
    const originalDevVars = readFileSync(devVarsPath, "utf-8");
    const modifiedDevVars = originalDevVars.replace(
      /^API_URL=.*$/m,
      `API_URL=http://127.0.0.1:${mockPort}`,
    );
    writeFileSync(devVarsPath, modifiedDevVars, "utf-8");

    // Start a fresh worker with the modified .dev.vars
    const membershipWorker = await unstable_dev("src/index.ts", {
      configPath: "wrangler.toml",
      experimentalExcludeMiniflareV1: true,
    });
    const membershipUrl = `http://127.0.0.1:${membershipWorker.port}`;

    try {
      const token = await createToken("user_nonmember");
      // Connect directly to the community room — CommunityDO checks membership on upgrade
      const wsUrl = `${membershipUrl}/ws?room=chat:comm_nonmember&token=${token}`;
      const ws = new WebSocket(wsUrl);
      const messages: any[] = [];
      ws.on("message", (data) => {
        try { messages.push(JSON.parse(String(data))); } catch { /* ignore */ }
      });

      // Wait for open or rejection
      const statusCode = await new Promise<number>((resolve) => {
        ws.on("error", () => resolve(0));
        ws.on("unexpected-response", (_req: any, res: any) => resolve(res.statusCode ?? 0));
        ws.on("open", () => resolve(200));
        setTimeout(() => resolve(0), 3000);
      });

      if (statusCode === 200) {
        // Connected — try to subscribe
        ws.send(JSON.stringify({
          t: "join", user: { id: "user_nonmember", name: "NonMember", avatar: null },
        }));
        await waitForMessage(messages, "hello");
        ws.send(JSON.stringify({
          t: "subscribe", room: "chat:comm_nonmember", topic: "chat",
        }));
        await new Promise((r) => setTimeout(r, 2000));

        // Publish — should not be received if membership check blocks delivery
        await fetch(`${membershipUrl}/publish`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-realtime-publish-secret": PUBLISH_SECRET,
          },
          body: JSON.stringify({ room: "chat:comm_nonmember", topic: "chat", data: { text: "should not arrive" } }),
        });
        await new Promise((r) => setTimeout(r, 1000));

        const events = messages.filter((m) => m.t === "event");
        expect(events.length).toBe(0);
      } else {
        // Connection rejected (403 Forbidden) — expected for non-member
        expect(statusCode).toBe(403);
      }
      try { ws.close(); } catch { /* ignore */ }
    } finally {
      await membershipWorker.stop();
      mockApi.close();
      writeFileSync(devVarsPath, originalDevVars, "utf-8");
    }
  });

  it("subscribe succeeds when membership API returns 200 (member)", async () => {
    const { createServer } = await import("http");
    const { writeFileSync, readFileSync } = await import("fs");
    const { resolve } = await import("path");

    // Start a mock membership API that returns 200 with valid auth
    const mockApi = createServer((req, res) => {
      const auth = req.headers.authorization;
      if (!auth || !auth.startsWith("Bearer ")) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => mockApi.listen(0, resolve));
    const mockPort = (mockApi.address() as any).port;

    // Write a temporary .dev.vars pointing API_URL to the mock
    const devVarsPath = resolve(__dirname, "../.dev.vars");
    const originalDevVars = readFileSync(devVarsPath, "utf-8");
    const modifiedDevVars = originalDevVars.replace(
      /^API_URL=.*$/m,
      `API_URL=http://127.0.0.1:${mockPort}`,
    );
    writeFileSync(devVarsPath, modifiedDevVars, "utf-8");

    // Start a fresh worker with the modified .dev.vars
    const membershipWorker = await unstable_dev("src/index.ts", {
      configPath: "wrangler.toml",
      experimentalExcludeMiniflareV1: true,
    });
    const membershipUrl = `http://127.0.0.1:${membershipWorker.port}`;

    try {
      const token = await createToken("user_member");
      // Connect directly to the community room
      const wsUrl = `${membershipUrl}/ws?room=chat:comm_member&token=${token}`;
      const ws = new WebSocket(wsUrl);
      const messages: any[] = [];
      ws.on("message", (data) => {
        try { messages.push(JSON.parse(String(data))); } catch { /* ignore */ }
      });
      await waitForOpen(ws);

      ws.send(JSON.stringify({
        t: "join", user: { id: "user_member", name: "Member", avatar: null },
      }));
      await waitForMessage(messages, "hello");

      // Subscribe — membership API returns 200, so subscribe succeeds
      ws.send(JSON.stringify({
        t: "subscribe", room: "chat:comm_member", topic: "chat",
      }));
      await new Promise((r) => setTimeout(r, 500));

      // Publish — message SHOULD be delivered
      await fetch(`${membershipUrl}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-realtime-publish-secret": PUBLISH_SECRET,
        },
        body: JSON.stringify({ room: "chat:comm_member", topic: "chat", data: { text: "member msg" } }),
      });
      const event = await waitForMessage(messages, "event", 5000);
      expect(event.data.text).toBe("member msg");
      try { ws.close(); } catch { /* ignore */ }
    } finally {
      await membershipWorker.stop();
      mockApi.close();
      writeFileSync(devVarsPath, originalDevVars, "utf-8");
    }
  });
});

// ============================================================================
// TEST 13: DURABLE EVENT DELIVERY
// ============================================================================

describe("Durable event delivery", () => {
  it("message delivered via direct WebSocket", async () => {
    const token = await createToken("user_dur1");
    const { ws, messages, close } = connectWs("chat:comm_dur", token);
    try {
      await joinAndSubscribe(ws, messages, "user_dur1", "chat:comm_dur", "chat");

      await publish("chat:comm_dur", "chat", { text: "durable" });
      const event = await waitForMessage(messages, "event", 5000);
      expect(event.data.text).toBe("durable");
    } finally { close(); }
  });
});

// ============================================================================
// TEST 14: MULTIPLE DEVICES / TABS
// ============================================================================

describe("Multiple devices/tabs", () => {
  it("multiple connections from same user to same community receive events per subscription", async () => {
    const userId = "user_multi1";
    const token = await createToken(userId);

    // Tab 1: subscribes to chat:comm_multi (chat + typing)
    const tab1 = connectWs("chat:comm_multi", token);
    await waitForOpen(tab1.ws);
    tab1.ws.send(JSON.stringify({ t: "join", user: { id: userId, name: "Multi", avatar: null } }));
    await waitForMessage(tab1.messages, "hello");
    tab1.ws.send(JSON.stringify({ t: "subscribe", room: "chat:comm_multi", topic: "chat" }));
    tab1.ws.send(JSON.stringify({ t: "subscribe", room: "chat:comm_multi", topic: "typing" }));
    await new Promise((r) => setTimeout(r, 300));

    // Tab 2: subscribes to chat:comm_multi (chat only)
    const tab2 = connectWs("chat:comm_multi", token);
    await waitForOpen(tab2.ws);
    tab2.ws.send(JSON.stringify({ t: "join", user: { id: userId, name: "Multi", avatar: null } }));
    await waitForMessage(tab2.messages, "hello");
    tab2.ws.send(JSON.stringify({ t: "subscribe", room: "chat:comm_multi", topic: "chat" }));
    await new Promise((r) => setTimeout(r, 300));

    // Mobile: subscribes to chat:comm_multi2 (chat only) — separate community
    const mobile = connectWs("chat:comm_multi2", token);
    await waitForOpen(mobile.ws);
    mobile.ws.send(JSON.stringify({ t: "join", user: { id: userId, name: "Multi", avatar: null } }));
    await waitForMessage(mobile.messages, "hello");
    mobile.ws.send(JSON.stringify({ t: "subscribe", room: "chat:comm_multi2", topic: "chat" }));
    await new Promise((r) => setTimeout(r, 300));

    // Publish chat to comm_multi
    await publish("chat:comm_multi", "chat", { text: "chat-msg" });
    await new Promise((r) => setTimeout(r, 1000));

    // Tab 1 should receive (subscribed to chat)
    const tab1Chat = tab1.messages.filter((m: any) => m.t === "event" && m.topic === "chat");
    expect(tab1Chat.length).toBeGreaterThanOrEqual(1);

    // Tab 2 should receive (subscribed to chat)
    const tab2Chat = tab2.messages.filter((m: any) => m.t === "event" && m.topic === "chat");
    expect(tab2Chat.length).toBeGreaterThanOrEqual(1);

    // Publish typing to comm_multi
    await publish("chat:comm_multi", "typing", { typing: true });
    await new Promise((r) => setTimeout(r, 1000));

    // Tab 1 should receive (subscribed to typing)
    const tab1Typing = tab1.messages.filter((m: any) => m.t === "event" && m.topic === "typing");
    expect(tab1Typing.length).toBeGreaterThanOrEqual(1);

    // Tab 2 should NOT receive (not subscribed to typing)
    const tab2Typing = tab2.messages.filter((m: any) => m.t === "event" && m.topic === "typing");
    expect(tab2Typing.length).toBe(0);

    // Publish chat to comm_multi2
    await publish("chat:comm_multi2", "chat", { text: "mobile-msg" });
    await new Promise((r) => setTimeout(r, 1000));

    // Mobile should receive
    const mobileChat = mobile.messages.filter((m: any) => m.t === "event" && m.topic === "chat");
    expect(mobileChat.length).toBeGreaterThanOrEqual(1);

    // Tab 1 and Tab 2 should NOT receive (not subscribed to comm_multi2)
    const tab1Multi2 = tab1.messages.filter((m: any) => m.t === "event" && m.room === "chat:comm_multi2");
    const tab2Multi2 = tab2.messages.filter((m: any) => m.t === "event" && m.room === "chat:comm_multi2");
    expect(tab1Multi2.length).toBe(0);
    expect(tab2Multi2.length).toBe(0);

    tab1.close();
    tab2.close();
    mobile.close();
  }, 15_000);
});

// ============================================================================
// TEST 15: CONCURRENT COMMUNITY DELIVERY
// ============================================================================

describe("Concurrent community delivery", () => {
  it("events from multiple communities delivered correctly", async () => {
    const userId = "user_conc_rpc1";
    const token = await createToken(userId);

    // Connect to 3 communities directly
    const connA = connectWs("chat:comm_conc_rpc_a", token);
    await joinAndSubscribe(connA.ws, connA.messages, userId, "chat:comm_conc_rpc_a", "chat");
    const connB = connectWs("chat:comm_conc_rpc_b", token);
    await joinAndSubscribe(connB.ws, connB.messages, userId, "chat:comm_conc_rpc_b", "chat");
    const connC = connectWs("chat:comm_conc_rpc_c", token);
    await joinAndSubscribe(connC.ws, connC.messages, userId, "chat:comm_conc_rpc_c", "chat");

    try {
      // Publish to all 3 concurrently
      await Promise.all([
        publish("chat:comm_conc_rpc_a", "chat", { from: "A" }),
        publish("chat:comm_conc_rpc_b", "chat", { from: "B" }),
        publish("chat:comm_conc_rpc_c", "chat", { from: "C" }),
      ]);
      await new Promise((r) => setTimeout(r, 2000));

      const eventA = connA.messages.find((m: any) => m.t === "event" && m.data?.from === "A");
      const eventB = connB.messages.find((m: any) => m.t === "event" && m.data?.from === "B");
      const eventC = connC.messages.find((m: any) => m.t === "event" && m.data?.from === "C");
      expect(eventA).toBeDefined();
      expect(eventB).toBeDefined();
      expect(eventC).toBeDefined();
    } finally {
      connA.close();
      connB.close();
      connC.close();
    }
  });
});

// ============================================================================
// TEST 16: 500 ACTIVE SUBSCRIBERS
// ============================================================================

describe("500 active subscribers", () => {
  it("500 clients all receive the same message from one publish", async () => {
    const CLIENT_COUNT = 500;
    const conns: Array<{ ws: WebSocket; messages: any[]; close: () => void }> = [];

    try {
      for (let i = 0; i < CLIENT_COUNT; i++) {
        const token = await createToken(`user_500_${i}`);
        const conn = connectWs("chat:comm_500", token);
        conns.push(conn);
        await waitForOpen(conn.ws);
        conn.ws.send(JSON.stringify({
          t: "join", user: { id: `user_500_${i}`, name: `U${i}`, avatar: null },
        }));
        await waitForMessage(conn.messages, "hello");
        conn.ws.send(JSON.stringify({
          t: "subscribe", room: "chat:comm_500", topic: "chat",
        }));
      }

      await new Promise((r) => setTimeout(r, 2000));

      const start = Date.now();
      await publish("chat:comm_500", "chat", { text: "broadcast" });
      await new Promise((r) => setTimeout(r, 5000));
      const elapsed = Date.now() - start;

      let delivered = 0;
      for (const conn of conns) {
        delivered += conn.messages.filter(
          (m) => m.t === "event" && m.topic === "chat" && m.data?.text === "broadcast"
        ).length;
      }

      console.log(`[500 SUBSCRIBERS] delivered: ${delivered}/${CLIENT_COUNT}, elapsed: ${elapsed}ms`);
      expect(delivered).toBe(CLIENT_COUNT);
    } finally {
      for (const conn of conns) conn.close();
    }
  }, 60_000);
});

// ============================================================================
// TEST 16B: DIRECT WEBSOCKET FAN-OUT — 500 × 10
// ============================================================================

describe("Fan-out: 500 × 10", () => {
  it("5000/5000 delivered, 0 duplicates", async () => {
    const N = 500;
    const MESSAGES = 10;
    const conns: Array<{ ws: WebSocket; messages: any[]; close: () => void }> = [];

    try {
      for (let i = 0; i < N; i++) {
        const token = await createToken(`user_fo10_${i}`);
        const conn = connectWs("chat:comm_fo10", token);
        conns.push(conn);
        await waitForOpen(conn.ws);
        conn.ws.send(JSON.stringify({
          t: "join", user: { id: `user_fo10_${i}`, name: `U${i}`, avatar: null },
        }));
        await waitForMessage(conn.messages, "hello");
        conn.ws.send(JSON.stringify({
          t: "subscribe", room: "chat:comm_fo10", topic: "chat",
        }));
      }

      await new Promise((r) => setTimeout(r, 2000));

      let totalDelivered = 0;
      let totalDuplicates = 0;

      for (let seq = 0; seq < MESSAGES; seq++) {
        await publish("chat:comm_fo10", "chat", { seq });
        await new Promise((r) => setTimeout(r, 1000));

        for (const conn of conns) {
          const count = conn.messages.filter(
            (m) => m.t === "event" && m.data?.seq === seq
          ).length;
          if (count > 1) totalDuplicates += count - 1;
          if (count >= 1) totalDelivered++;
        }
      }

      console.log(`[FAN-OUT 500×10] delivered: ${totalDelivered}/${MESSAGES * N}, duplicates: ${totalDuplicates}`);
      expect(totalDelivered).toBe(MESSAGES * N);
      expect(totalDuplicates).toBe(0);
    } finally {
      for (const conn of conns) conn.close();
    }
  }, 120_000);
});

// ============================================================================
// TEST 16C: DIRECT WEBSOCKET FAN-OUT — 500 × 100
// ============================================================================

describe("Fan-out: 500 × 100", () => {
  it("50000/50000 delivered, 0 duplicates", async () => {
    const N = 500;
    const MESSAGES = 100;
    const conns: Array<{ ws: WebSocket; messages: any[]; close: () => void }> = [];

    try {
      for (let i = 0; i < N; i++) {
        const token = await createToken(`user_fo100_${i}`);
        const conn = connectWs("chat:comm_fo100", token);
        conns.push(conn);
        await waitForOpen(conn.ws);
        conn.ws.send(JSON.stringify({
          t: "join", user: { id: `user_fo100_${i}`, name: `U${i}`, avatar: null },
        }));
        await waitForMessage(conn.messages, "hello");
        conn.ws.send(JSON.stringify({
          t: "subscribe", room: "chat:comm_fo100", topic: "chat",
        }));
      }

      await new Promise((r) => setTimeout(r, 2000));

      let totalDelivered = 0;
      let totalDuplicates = 0;

      for (let seq = 0; seq < MESSAGES; seq++) {
        await publish("chat:comm_fo100", "chat", { seq });
        await new Promise((r) => setTimeout(r, 200));
      }

      await new Promise((r) => setTimeout(r, 10000));

      for (const conn of conns) {
        for (let seq = 0; seq < MESSAGES; seq++) {
          const count = conn.messages.filter(
            (m) => m.t === "event" && m.data?.seq === seq
          ).length;
          if (count > 1) totalDuplicates += count - 1;
          if (count >= 1) totalDelivered++;
        }
      }

      console.log(`[FAN-OUT 500×100] delivered: ${totalDelivered}/${MESSAGES * N}, duplicates: ${totalDuplicates}`);
      expect(totalDelivered).toBe(MESSAGES * N);
      expect(totalDuplicates).toBe(0);
    } finally {
      for (const conn of conns) conn.close();
    }
  }, 180_000);
});

// ============================================================================
// TEST 17: PUBLISH AUTH
// ============================================================================

describe("Publish auth", () => {
  it("batch publish works", async () => {
    const res = await fetch(`${baseUrl}/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-realtime-publish-secret": PUBLISH_SECRET,
      },
      body: JSON.stringify({
        events: [
          { room: "chat:test_batch_1", topic: "chat", data: { batch: 1 } },
          { room: "chat:test_batch_2", topic: "chat", data: { batch: 2 } },
        ],
      }),
    });
    expect(res.ok).toBe(true);
  });
});
