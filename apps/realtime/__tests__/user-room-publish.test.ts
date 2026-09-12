/**
 * End-to-end regression tests for user-scoped realtime delivery.
 *
 * The bug these lock down: the server published `notifications:${userId}` and
 * `profile:${userId}` into the COMMUNITY_DO namespace, while every browser's
 * user-scoped socket lives in that user's USER_DO instance. The event therefore
 * landed in a Durable Object with no sockets attached — `/publish` still
 * answered "ok", so nothing looked broken and every client silently fell back
 * to its periodic refetch.
 *
 * These tests connect a real WebSocket the way the app does (`room=user:${id}`,
 * user-scoped rooms multiplexed as subscribe frames) and assert the event
 * actually arrives.
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

async function createToken(userId: string): Promise<string> {
  const { SignJWT } = await import("jose");
  const secret = new TextEncoder().encode(SESSION_SECRET);
  return new SignJWT({ userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

/** Connect exactly like the browser does: one user socket for user-scoped rooms. */
async function connectUserSocket(userId: string) {
  const token = await createToken(userId);
  const url = `${baseUrl}/ws?room=${encodeURIComponent(`user:${userId}`)}&token=${encodeURIComponent(token)}`;
  const ws = new WebSocket(url);
  const messages: any[] = [];
  ws.on("message", (data) => {
    try {
      messages.push(JSON.parse(String(data)));
    } catch {
      /* ignore non-JSON */
    }
  });
  return { ws, messages, close: () => { try { ws.close(); } catch { /* ignore */ } } };
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

/** Join + subscribe the way the client does before receiving events. */
async function joinAndSubscribe(
  ws: WebSocket,
  messages: any[],
  userId: string,
  subscriptions: Array<{ room: string; topic: string }>,
) {
  await waitForOpen(ws);
  ws.send(JSON.stringify({ t: "join", user: { id: userId, name: `User ${userId}`, avatar: null } }));
  await waitForCondition(() => messages.some((m) => m.t === "hello"), "hello");
  for (const { room, topic } of subscriptions) {
    ws.send(JSON.stringify({ t: "subscribe", room, topic }));
  }
  // Give the DO a beat to persist the subscription before publishing.
  await new Promise((r) => setTimeout(r, 300));
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

function findEvent(messages: any[], room: string, topic: string) {
  return messages.find((m) => m.t === "event" && m.room === room && m.topic === topic);
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

describe("user-scoped room delivery", () => {
  it("delivers a notification insert to the recipient's socket", async () => {
    const userId = "notif-recipient";
    const conn = await connectUserSocket(userId);

    try {
      await joinAndSubscribe(conn.ws, conn.messages, userId, [
        { room: `notifications:${userId}`, topic: "insert" },
      ]);

      const response = await publish(`notifications:${userId}`, "insert", { id: "n-1", title: "Alice posted" });
      expect(response.status).toBe(200);

      await waitForCondition(
        () => Boolean(findEvent(conn.messages, `notifications:${userId}`, "insert")),
        "notification event",
      );
      expect(findEvent(conn.messages, `notifications:${userId}`, "insert").data).toEqual({
        id: "n-1",
        title: "Alice posted",
      });
    } finally {
      conn.close();
    }
  });

  it("delivers a profile update to the recipient's socket", async () => {
    const userId = "profile-owner";
    const conn = await connectUserSocket(userId);

    try {
      await joinAndSubscribe(conn.ws, conn.messages, userId, [
        { room: `profile:${userId}`, topic: "thread" },
      ]);

      await publish(`profile:${userId}`, "thread", { id: "t-1" });

      await waitForCondition(
        () => Boolean(findEvent(conn.messages, `profile:${userId}`, "thread")),
        "profile event",
      );
    } finally {
      conn.close();
    }
  });

  it("carries multiple user-scoped rooms over the single user socket", async () => {
    const userId = "multi-room-user";
    const conn = await connectUserSocket(userId);

    try {
      await joinAndSubscribe(conn.ws, conn.messages, userId, [
        { room: `notifications:${userId}`, topic: "insert" },
        { room: `profile:${userId}`, topic: "thread" },
      ]);

      await publish(`notifications:${userId}`, "insert", { id: "n-2" });
      await publish(`profile:${userId}`, "thread", { id: "t-2" });

      await waitForCondition(() => Boolean(findEvent(conn.messages, `notifications:${userId}`, "insert")), "notification");
      await waitForCondition(() => Boolean(findEvent(conn.messages, `profile:${userId}`, "thread")), "profile thread");
    } finally {
      conn.close();
    }
  });

  it("does not leak one user's events to another user's socket", async () => {
    const alice = "isolation-alice";
    const bob = "isolation-bob";
    const aliceConn = await connectUserSocket(alice);
    const bobConn = await connectUserSocket(bob);

    try {
      await joinAndSubscribe(aliceConn.ws, aliceConn.messages, alice, [
        { room: `notifications:${alice}`, topic: "insert" },
      ]);
      await joinAndSubscribe(bobConn.ws, bobConn.messages, bob, [
        { room: `notifications:${bob}`, topic: "insert" },
      ]);

      await publish(`notifications:${alice}`, "insert", { id: "for-alice" });
      await waitForCondition(
        () => Boolean(findEvent(aliceConn.messages, `notifications:${alice}`, "insert")),
        "alice notification",
      );

      // Bob's socket is subscribed to his own room only.
      expect(findEvent(bobConn.messages, `notifications:${bob}`, "insert")).toBeUndefined();
      expect(findEvent(bobConn.messages, `notifications:${alice}`, "insert")).toBeUndefined();
    } finally {
      aliceConn.close();
      bobConn.close();
    }
  });
});
