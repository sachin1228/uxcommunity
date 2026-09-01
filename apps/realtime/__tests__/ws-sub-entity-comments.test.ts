/**
 * Sub-entity Comment WebSocket Tests
 *
 * Tests thread-comments: and resource-comments: rooms route to CommunityDO
 * after the routing fix (previously these mismatched: client→UserDO, server→CommunityDO).
 *
 * Architecture:
 *   Client → CommunityDO (direct WebSocket) → ws.send() → Client(s)
 *   0 RPCs for message delivery.
 *
 * Run: npx vitest run __tests__/ws-sub-entity-comments.test.ts --reporter=verbose
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
// TEST 1: THREAD COMMENT REALTIME DELIVERY
// ============================================================================

describe("Sub-entity comments: thread-comments delivery", () => {
  it("client A publishes a thread comment → client B receives it", async () => {
    const room = "thread-comments:thread-delivery-1";
    const tokenA = await createToken("tc_deliver_a");
    const tokenB = await createToken("tc_deliver_b");

    const connA = connectCommunityWs(room, tokenA);
    const connB = connectCommunityWs(room, tokenB);
    try {
      await joinAndSubscribe(connA.ws, connA.messages, "tc_deliver_a", room, "comment");
      await joinAndSubscribe(connB.ws, connB.messages, "tc_deliver_b", room, "comment");
      await new Promise((r) => setTimeout(r, 500));

      await publish(room, "comment", { user_id: "tc_deliver_a", body: "Nice thread!" });
      const event = await waitForMessage(connB.messages, "event", 5000);
      expect(event.t).toBe("event");
      expect(event.room).toBe(room);
      expect(event.topic).toBe("comment");
      expect(event.data.user_id).toBe("tc_deliver_a");
    } finally {
      connA.close();
      connB.close();
    }
  });
});

// ============================================================================
// TEST 2: RESOURCE COMMENT REALTIME DELIVERY
// ============================================================================

describe("Sub-entity comments: resource-comments delivery", () => {
  it("client A publishes a resource comment → client B receives it", async () => {
    const room = "resource-comments:resource-delivery-1";
    const tokenA = await createToken("rc_deliver_a");
    const tokenB = await createToken("rc_deliver_b");

    const connA = connectCommunityWs(room, tokenA);
    const connB = connectCommunityWs(room, tokenB);
    try {
      await joinAndSubscribe(connA.ws, connA.messages, "rc_deliver_a", room, "comment");
      await joinAndSubscribe(connB.ws, connB.messages, "rc_deliver_b", room, "comment");
      await new Promise((r) => setTimeout(r, 500));

      await publish(room, "comment", { user_id: "rc_deliver_a", body: "Great resource!" });
      const event = await waitForMessage(connB.messages, "event", 5000);
      expect(event.t).toBe("event");
      expect(event.room).toBe(room);
      expect(event.topic).toBe("comment");
      expect(event.data.user_id).toBe("rc_deliver_a");
    } finally {
      connA.close();
      connB.close();
    }
  });
});

// ============================================================================
// TEST 3: THREAD COMMENT ISOLATION
// ============================================================================

describe("Sub-entity comments: thread comment isolation", () => {
  it("thread A event does NOT reach thread B", async () => {
    const roomA = "thread-comments:thread-iso-a";
    const roomB = "thread-comments:thread-iso-b";

    const tokenB = await createToken("tc_iso_b");
    const connB = connectCommunityWs(roomB, tokenB);
    try {
      await joinAndSubscribe(connB.ws, connB.messages, "tc_iso_b", roomB, "comment");
      await new Promise((r) => setTimeout(r, 500));

      await publish(roomA, "comment", { user_id: "tc_iso_a", body: "Thread A comment" });
      await new Promise((r) => setTimeout(r, 1500));

      const crossEvents = connB.messages.filter(
        (m) => m.t === "event" && m.data?.body === "Thread A comment",
      );
      expect(crossEvents.length).toBe(0);
    } finally {
      connB.close();
    }
  });
});

// ============================================================================
// TEST 4: RESOURCE COMMENT ISOLATION
// ============================================================================

describe("Sub-entity comments: resource comment isolation", () => {
  it("resource A event does NOT reach resource B", async () => {
    const roomA = "resource-comments:resource-iso-a";
    const roomB = "resource-comments:resource-iso-b";

    const tokenB = await createToken("rc_iso_b");
    const connB = connectCommunityWs(roomB, tokenB);
    try {
      await joinAndSubscribe(connB.ws, connB.messages, "rc_iso_b", roomB, "comment");
      await new Promise((r) => setTimeout(r, 500));

      await publish(roomA, "comment", { user_id: "rc_iso_a", body: "Resource A comment" });
      await new Promise((r) => setTimeout(r, 1500));

      const crossEvents = connB.messages.filter(
        (m) => m.t === "event" && m.data?.body === "Resource A comment",
      );
      expect(crossEvents.length).toBe(0);
    } finally {
      connB.close();
    }
  });
});

// ============================================================================
// TEST 5: CROSS-TYPE ISOLATION (thread-comments vs resource-comments)
// ============================================================================

describe("Sub-entity comments: cross-type isolation", () => {
  it("thread-comments event does NOT reach resource-comments sockets", async () => {
    const threadRoom = "thread-comments:cross-iso-thread";
    const resourceRoom = "resource-comments:cross-iso-resource";

    const tokenR = await createToken("cross_iso_r");
    const connR = connectCommunityWs(resourceRoom, tokenR);
    try {
      await joinAndSubscribe(connR.ws, connR.messages, "cross_iso_r", resourceRoom, "comment");
      await new Promise((r) => setTimeout(r, 500));

      await publish(threadRoom, "comment", { user_id: "cross_iso_t", body: "Thread comment" });
      await new Promise((r) => setTimeout(r, 1500));

      const crossEvents = connR.messages.filter(
        (m) => m.t === "event" && m.data?.body === "Thread comment",
      );
      expect(crossEvents.length).toBe(0);
    } finally {
      connR.close();
    }
  });

  it("resource-comments event does NOT reach thread-comments sockets", async () => {
    const threadRoom = "thread-comments:cross-iso-thread2";
    const resourceRoom = "resource-comments:cross-iso-resource2";

    const tokenT = await createToken("cross_iso_t2");
    const connT = connectCommunityWs(threadRoom, tokenT);
    try {
      await joinAndSubscribe(connT.ws, connT.messages, "cross_iso_t2", threadRoom, "comment");
      await new Promise((r) => setTimeout(r, 500));

      await publish(resourceRoom, "comment", { user_id: "cross_iso_r2", body: "Resource comment" });
      await new Promise((r) => setTimeout(r, 1500));

      const crossEvents = connT.messages.filter(
        (m) => m.t === "event" && m.data?.body === "Resource comment",
      );
      expect(crossEvents.length).toBe(0);
    } finally {
      connT.close();
    }
  });
});

// ============================================================================
// TEST 6: RECONNECT
// ============================================================================

describe("Sub-entity comments: reconnect", () => {
  it("disconnect and reconnect a thread-comment socket → events still arrive", async () => {
    const room = "thread-comments:reconnect-1";
    const token = await createToken("tc_reconnect");

    const conn1 = connectCommunityWs(room, token);
    try {
      await joinAndSubscribe(conn1.ws, conn1.messages, "tc_reconnect", room, "comment");

      // Publish first event — should arrive
      await publish(room, "comment", { user_id: "other", body: "before disconnect" });
      const ev1 = await waitForMessage(conn1.messages, "event", 5000);
      expect(ev1.data.body).toBe("before disconnect");
    } finally {
      conn1.close();
    }

    // Reconnect
    const conn2 = connectCommunityWs(room, token);
    try {
      await joinAndSubscribe(conn2.ws, conn2.messages, "tc_reconnect", room, "comment");
      await new Promise((r) => setTimeout(r, 500));

      // Publish second event — should arrive on new connection
      await publish(room, "comment", { user_id: "other", body: "after reconnect" });
      const ev2 = await waitForMessage(conn2.messages, "event", 5000);
      expect(ev2.data.body).toBe("after reconnect");
    } finally {
      conn2.close();
    }
  });
});

// ============================================================================
// TEST 7: MULTI-DEVICE
// ============================================================================

describe("Sub-entity comments: multi-device", () => {
  it("same user on two sockets for the same thread → both receive event", async () => {
    const room = "thread-comments:multidevice-1";
    const token = await createToken("tc_multidevice");

    const conn1 = connectCommunityWs(room, token);
    const conn2 = connectCommunityWs(room, token);
    try {
      await joinAndSubscribe(conn1.ws, conn1.messages, "tc_multidevice", room, "comment");
      await joinAndSubscribe(conn2.ws, conn2.messages, "tc_multidevice", room, "comment");
      await new Promise((r) => setTimeout(r, 500));

      await publish(room, "comment", { user_id: "other", body: "multi-device test" });

      const ev1 = await waitForMessage(conn1.messages, "event", 5000);
      const ev2 = await waitForMessage(conn2.messages, "event", 5000);
      expect(ev1.data.body).toBe("multi-device test");
      expect(ev2.data.body).toBe("multi-device test");
    } finally {
      conn1.close();
      conn2.close();
    }
  });

  it("closing one socket does not break the other", async () => {
    const room = "thread-comments:multidevice-2";
    const token = await createToken("tc_multidevice2");

    const conn1 = connectCommunityWs(room, token);
    const conn2 = connectCommunityWs(room, token);
    try {
      await joinAndSubscribe(conn1.ws, conn1.messages, "tc_multidevice2", room, "comment");
      await joinAndSubscribe(conn2.ws, conn2.messages, "tc_multidevice2", room, "comment");
      await new Promise((r) => setTimeout(r, 500));

      // Close first socket
      conn1.close();
      await new Promise((r) => setTimeout(r, 500));

      // Publish — second socket should still receive
      await publish(room, "comment", { user_id: "other", body: "after close" });
      const ev2 = await waitForMessage(conn2.messages, "event", 5000);
      expect(ev2.data.body).toBe("after close");
    } finally {
      conn2.close();
    }
  });
});

// ============================================================================
// TEST 8: ROUTING TABLE CONSISTENCY
// ============================================================================

describe("Sub-entity comments: routing table", () => {
  it("thread-comments rooms route to CommunityDO (not UserDO)", async () => {
    const room = "thread-comments:routing-check-1";
    const token = await createToken("tc_routing");

    const conn = connectCommunityWs(room, token);
    try {
      await joinAndSubscribe(conn.ws, conn.messages, "tc_routing", room, "comment");

      // Verify we got a hello from CommunityDO (connection established)
      const hello = conn.messages.find((m) => m.t === "hello");
      expect(hello).toBeDefined();
      expect(hello.connectionId).toBeDefined();
    } finally {
      conn.close();
    }
  });

  it("resource-comments rooms route to CommunityDO (not UserDO)", async () => {
    const room = "resource-comments:routing-check-2";
    const token = await createToken("rc_routing");

    const conn = connectCommunityWs(room, token);
    try {
      await joinAndSubscribe(conn.ws, conn.messages, "rc_routing", room, "comment");

      const hello = conn.messages.find((m) => m.t === "hello");
      expect(hello).toBeDefined();
      expect(hello.connectionId).toBeDefined();
    } finally {
      conn.close();
    }
  });
});
