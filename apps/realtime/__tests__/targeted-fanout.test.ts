/**
 * Integration tests for targeted fan-out and socket lifecycle in CommunityDO.
 *
 * The behaviour these pin:
 *   - a publish reaches ONLY the sockets subscribed to that topic (the previous
 *     implementation walked every socket attached to the DO);
 *   - a socket that closed is gone from the room immediately (visible through
 *     the aggregate `/stats` endpoint);
 *   - duplicate subscribe frames (React remount, reconnect replay) do not
 *     multiply deliveries;
 *   - reconnect re-subscribes without duplicating or replaying;
 *   - presence snapshots are folded per user and coalesced instead of being
 *     broadcast once per join.
 *
 * Kept to a handful of sockets: the test runner, not the Worker, is the
 * bottleneck at four-digit connection counts.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { unstable_dev } from "wrangler";
import type { UnstableDevWorker } from "wrangler";
import WebSocket from "ws";
import { readFileSync } from "fs";
import { resolve } from "path";

const devVars = readFileSync(resolve(__dirname, "../.dev.vars"), "utf-8");
const vars = Object.fromEntries(
  devVars
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [k, ...v] = line.split("=");
      return [k.trim(), v.join("=").trim()];
    }),
);
const SESSION_SECRET = vars.SESSION_SECRET;
const PUBLISH_SECRET = vars.REALTIME_PUBLISH_SECRET;

let worker: UnstableDevWorker;
let baseUrl: string;

interface Conn {
  ws: WebSocket;
  messages: any[];
  userId: string;
  close: () => void;
}

async function createToken(userId: string): Promise<string> {
  const { SignJWT } = await import("jose");
  const secret = new TextEncoder().encode(SESSION_SECRET);
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

/** Connect to a community room the way the browser does. */
async function connectRoom(room: string, userId: string): Promise<Conn> {
  const token = await createToken(userId);
  const ws = new WebSocket(
    `${baseUrl}/ws?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}`,
  );
  const messages: any[] = [];
  ws.on("message", (data) => {
    try {
      messages.push(JSON.parse(String(data)));
    } catch {
      /* ignore non-JSON */
    }
  });
  return { ws, messages, userId, close: () => { try { ws.close(); } catch { /* ignore */ } } };
}

function waitForOpen(ws: WebSocket, ms = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    const timer = setTimeout(() => reject(new Error("WS open timeout")), ms);
    ws.on("open", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForCondition(fn: () => boolean, label: string, ms = 5000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (fn()) return resolve();
      if (Date.now() - start > ms) return reject(new Error(`Timeout waiting for ${label}`));
      setTimeout(check, 50);
    };
    check();
  });
}

async function joinRoom(conn: Conn, room: string, topics: string[]) {
  await waitForOpen(conn.ws);
  conn.ws.send(JSON.stringify({ t: "join", user: { id: conn.userId, name: `User ${conn.userId}`, avatar: null } }));
  await waitForCondition(() => conn.messages.some((m) => m.t === "hello"), "hello");
  for (const topic of topics) {
    conn.ws.send(JSON.stringify({ t: "subscribe", room, topic }));
  }
  await sleep(200);
}

async function publish(room: string, topic: string, data: unknown) {
  return fetch(`${baseUrl}/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-realtime-publish-secret": PUBLISH_SECRET,
    },
    body: JSON.stringify({ room, topic, data }),
  });
}

/** Aggregate-only counters exposed by the DO (secret-protected). */
async function stats(room: string): Promise<any> {
  const response = await fetch(`${baseUrl}/stats?room=${encodeURIComponent(room)}`, {
    headers: { "x-realtime-publish-secret": PUBLISH_SECRET },
  });
  return response.json();
}

/** Poll until the room reports exactly `count` attached sockets. */
async function waitForSocketCount(room: string, count: number, ms = 5000): Promise<number> {
  const start = Date.now();
  for (;;) {
    const current = (await stats(room)).sockets as number;
    if (current === count) return current;
    if (Date.now() - start > ms) return current;
    await sleep(100);
  }
}

function eventsOn(conn: Conn, topic: string, seq?: number) {
  return conn.messages.filter(
    (m) => m.t === "event" && m.topic === topic && (seq === undefined || m.data?.seq === seq),
  );
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

describe("targeted fan-out", () => {
  it("delivers a topic only to its subscribers", async () => {
    const room = "chat:targeted-topic";
    const chatSockets = [
      await connectRoom(room, "u-chat-1"),
      await connectRoom(room, "u-chat-2"),
      await connectRoom(room, "u-chat-3"),
    ];
    const typingSockets = [await connectRoom(room, "u-typing-1"), await connectRoom(room, "u-typing-2")];
    const all = [...chatSockets, ...typingSockets];

    try {
      for (const conn of chatSockets) await joinRoom(conn, room, ["chat"]);
      for (const conn of typingSockets) await joinRoom(conn, room, ["typing"]);
      await sleep(300);

      await publish(room, "chat", { seq: 1 });
      await publish(room, "typing", { seq: 2 });
      await sleep(700);

      for (const conn of chatSockets) {
        expect(eventsOn(conn, "chat", 1).length).toBe(1);
        expect(eventsOn(conn, "typing", 2).length).toBe(0);
      }
      for (const conn of typingSockets) {
        expect(eventsOn(conn, "typing", 2).length).toBe(1);
        expect(eventsOn(conn, "chat", 1).length).toBe(0);
      }

      // Fan-out is accounted per recipient, not per attached socket: three
      // chat subscribers + two typing subscribers, while five sockets are open.
      const counters = await stats(room);
      expect(counters.sockets).toBe(5);
      expect(counters.metrics.fanoutRecipients).toBe(5);
      // Each event delivery is accounted; presence snapshots share this counter,
      // so it is a floor rather than an exact match for the two publishes.
      expect(counters.metrics.deliverAttempts).toBeGreaterThanOrEqual(5);
    } finally {
      for (const conn of all) conn.close();
    }
  });

  it("delivers exactly one copy despite duplicate subscribe frames", async () => {
    const room = "chat:dup-subscribe";
    const conn = await connectRoom(room, "u-dup");

    try {
      await joinRoom(conn, room, ["chat"]);
      for (let i = 0; i < 5; i += 1) {
        conn.ws.send(JSON.stringify({ t: "subscribe", room, topic: "chat" }));
      }
      await sleep(300);

      await publish(room, "chat", { seq: 7 });
      await sleep(600);

      expect(eventsOn(conn, "chat", 7).length).toBe(1);
    } finally {
      conn.close();
    }
  });

  it("stops delivering after unsubscribe", async () => {
    const room = "chat:unsubscribe";
    const leaving = await connectRoom(room, "u-leaving");
    const staying = await connectRoom(room, "u-staying");

    try {
      await joinRoom(leaving, room, ["chat"]);
      await joinRoom(staying, room, ["chat"]);

      await publish(room, "chat", { seq: 1 });
      await sleep(500);
      expect(eventsOn(leaving, "chat", 1).length).toBe(1);
      expect(eventsOn(staying, "chat", 1).length).toBe(1);

      leaving.ws.send(JSON.stringify({ t: "unsubscribe", room, topic: "chat" }));
      await sleep(300);
      await publish(room, "chat", { seq: 2 });
      await sleep(500);

      expect(eventsOn(leaving, "chat", 2).length).toBe(0);
      expect(eventsOn(staying, "chat", 2).length).toBe(1);
    } finally {
      leaving.close();
      staying.close();
    }
  });

  it("removes a disconnected socket from the room immediately", async () => {
    const room = "chat:disconnect-cleanup";
    const leaving = await connectRoom(room, "u-leaving");
    const staying = await connectRoom(room, "u-staying");

    try {
      await joinRoom(leaving, room, ["chat"]);
      await joinRoom(staying, room, ["chat"]);
      expect(await waitForSocketCount(room, 2)).toBe(2);

      leaving.close();
      // No ghost socket left in the index for the next event to retry.
      expect(await waitForSocketCount(room, 1)).toBe(1);

      await publish(room, "chat", { seq: 3 });
      await sleep(500);
      expect(eventsOn(leaving, "chat", 3).length).toBe(0);
      expect(eventsOn(staying, "chat", 3).length).toBe(1);
    } finally {
      leaving.close();
      staying.close();
    }
  });

  it("re-subscribes on reconnect without duplicating or replaying", async () => {
    const room = "chat:reconnect";
    const userId = "u-reconnect";

    const first = await connectRoom(room, userId);
    await joinRoom(first, room, ["chat"]);
    await publish(room, "chat", { seq: 1 });
    await sleep(500);
    expect(eventsOn(first, "chat", 1).length).toBe(1);
    first.close();
    await sleep(300);

    const second = await connectRoom(room, userId);
    try {
      await joinRoom(second, room, ["chat"]);
      await publish(room, "chat", { seq: 2 });
      await sleep(600);

      expect(eventsOn(second, "chat", 2).length).toBe(1);
      expect(eventsOn(second, "chat", 1).length).toBe(0);
    } finally {
      second.close();
    }
  });

  it("folds multiple tabs into one presence entry and coalesces snapshots", async () => {
    const room = "chat:presence-coalesce";
    const userA = [await connectRoom(room, "presence-a"), await connectRoom(room, "presence-a")];
    const userB = [await connectRoom(room, "presence-b")];
    const all = [...userA, ...userB];

    try {
      // Join one at a time, as a reconnect storm would.
      for (const conn of all) {
        await joinRoom(conn, room, ["chat"]);
      }
      await sleep(800);

      const presenceFrames = userB[0]!.messages.filter((m) => m.t === "presence");
      const lastPresence = presenceFrames.at(-1);
      expect(lastPresence).toBeTruthy();

      const users = lastPresence.users as Array<{ id: string; connections: number }>;
      expect(users.find((u) => u.id === "presence-a")?.connections).toBe(2);
      expect(users.find((u) => u.id === "presence-b")?.connections).toBe(1);

      // Three joins must not produce a full snapshot per socket.
      expect(presenceFrames.length).toBeLessThan(all.length);
    } finally {
      for (const conn of all) conn.close();
    }
  });
});
