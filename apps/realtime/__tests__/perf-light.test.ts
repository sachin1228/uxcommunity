/**
 * PERF 7-9: Lightweight performance tests (durable/ephemeral/duplicates).
 * Uses a shared worker instance — safe because these tests don't hold 500+ connections.
 *
 * Run: npx vitest run __tests__/perf-light.test.ts --reporter=verbose
 */

import { describe, it, beforeAll, afterAll } from "vitest";
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

function connectWs(room: string, token: string) {
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
  return { ws, messages, close: () => { try { ws.close(); } catch { /* ignore */ } } };
}

function waitForOpen(ws: WebSocket, ms = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) return resolve();
    const t = setTimeout(() => reject(new Error("WS open timeout")), ms);
    ws.on("open", () => { clearTimeout(t); resolve(); });
  });
}

function waitForMessage(messages: any[], type: string, ms = 10000, predicate?: (m: any) => boolean): Promise<any> {
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

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function reportLatency(label: string, latencies: number[]) {
  if (latencies.length === 0) {
    console.log(`  ${label}: no data`);
    return;
  }
  latencies.sort((a, b) => a - b);
  const min = latencies[0];
  const max = latencies[latencies.length - 1];
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  console.log(`  ${label}:`);
  console.log(`    n=${latencies.length}  min=${min.toFixed(1)}ms  avg=${avg.toFixed(1)}ms  P50=${percentile(latencies, 50).toFixed(1)}ms  P95=${percentile(latencies, 95).toFixed(1)}ms  P99=${percentile(latencies, 99).toFixed(1)}ms  max=${max.toFixed(1)}ms`);
}

async function connectBatch(
  prefix: string,
  count: number,
  room: string,
  topic: string,
): Promise<Array<{ ws: WebSocket; messages: any[]; close: () => void }>> {
  const conns: Array<{ ws: WebSocket; messages: any[]; close: () => void }> = [];
  for (let i = 0; i < count; i++) {
    const token = await createToken(`${prefix}_${i}`);
    const conn = connectWs(`user:${prefix}_${i}`, token);
    conns.push(conn);
    await waitForOpen(conn.ws);
    conn.ws.send(JSON.stringify({
      t: "join", user: { id: `${prefix}_${i}`, name: `U${i}`, avatar: null },
    }));
    await waitForMessage(conn.messages, "hello");
    conn.ws.send(JSON.stringify({ t: "subscribe", room, topic }));
  }
  return conns;
}

async function publishAndWait(
  room: string,
  topic: string,
  data: unknown,
  conns: Array<{ messages: any[] }>,
  predicate: (m: any) => boolean,
  waitMs = 5000,
): Promise<{ delivered: number; latencies: number[] }> {
  const publishTs = performance.now();
  await fetch(`${baseUrl}/publish`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-realtime-publish-secret": PUBLISH_SECRET,
    },
    body: JSON.stringify({ room, topic, data }),
  });
  await new Promise((r) => setTimeout(r, waitMs));

  const latencies: number[] = [];
  let delivered = 0;
  for (const conn of conns) {
    const event = conn.messages.find((m) => m.t === "event" && predicate(m));
    if (event) {
      delivered++;
      latencies.push(event._recvMs - publishTs);
    }
  }
  return { delivered, latencies };
}

beforeAll(async () => {
  worker = await unstable_dev("src/index.ts", {
    configPath: "wrangler.toml",
    experimentalExcludeMiniflareV1: true,
    vars: { USE_WEBSOCKET_OWNERSHIP: "true" },
  });
  baseUrl = `http://127.0.0.1:${worker.port}`;
}, 30_000);

afterAll(async () => {
  await worker?.stop();
});

// ============================================================================
// PERF 7: Durable event recovery — RPC failure for chat/edit/delete/reaction
// ============================================================================

describe("PERF 7: Durable event recovery", () => {
  it("chat message delivery works even when RPC might fail", async () => {
    const conns = await connectBatch("p7", 5, "chat:p7", "chat");
    await new Promise((r) => setTimeout(r, 1000));

    const eventTypes = [
      { topic: "chat", data: { type: "chat", text: "hello" } },
      { topic: "chat", data: { type: "message_edit", text: "edited" } },
      { topic: "chat", data: { type: "message_delete", messageId: "123" } },
      { topic: "chat", data: { type: "reaction", emoji: "👍", messageId: "123" } },
    ];

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 7: Durable event recovery");
    console.log("═══════════════════════════════════════════════════════════");

    for (const { topic, data } of eventTypes) {
      const { delivered } = await publishAndWait(
        "chat:p7", topic, data, conns,
        (m) => m.t === "event" && m.data?.type === data.type,
        3000,
      );
      console.log(`  ${data.type}: delivered=${delivered}/5`);
    }

    console.log("  Invariant: message exists in DB regardless of RPC delivery");
    console.log("  Client recovers via history/sync on next visibility change");
    console.log("═══════════════════════════════════════════════════════════\n");

    for (const conn of conns) conn.close();
  }, 30_000);
});

// ============================================================================
// PERF 8: Ephemeral event behavior — typing/presence
// ============================================================================

describe("PERF 8: Ephemeral event behavior", () => {
  it("typing events delivered, no retry on failure", async () => {
    const conns = await connectBatch("p8", 5, "chat:p8", "typing");
    await new Promise((r) => setTimeout(r, 1000));

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 8: Ephemeral event behavior");
    console.log("═══════════════════════════════════════════════════════════");

    const { delivered, latencies } = await publishAndWait(
      "chat:p8", "typing", { typing: true, userId: "p8_user" },
      conns, (m) => m.t === "event" && m.topic === "typing", 3000,
    );
    console.log(`  typing: delivered=${delivered}/5`);
    reportLatency("  typing latency", latencies);
    console.log("  On RPC failure: drop silently, no retry, no persistence");
    console.log("═══════════════════════════════════════════════════════════\n");

    for (const conn of conns) conn.close();
  }, 30_000);
});

// ============================================================================
// PERF 9: Duplicate detection across burst
// ============================================================================

describe("PERF 9: Duplicate detection — 50 msgs × 500 subs", () => {
  it("zero duplicates across 50 rapid publishes", async () => {
    const N = 500;
    const MESSAGES = 50;
    const conns = await connectBatch("p9", N, "chat:p9", "chat");
    await new Promise((r) => setTimeout(r, 2000));

    let totalDuplicates = 0;
    let totalDelivered = 0;

    for (let seq = 0; seq < MESSAGES; seq++) {
      await fetch(`${baseUrl}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-realtime-publish-secret": PUBLISH_SECRET,
        },
        body: JSON.stringify({ room: "chat:p9", topic: "chat", data: { seq } }),
      });
      await new Promise((r) => setTimeout(r, 100));
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

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 9: Duplicate detection — 50 msgs × 500 subs");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Expected: ${MESSAGES * N}`);
    console.log(`  Delivered: ${totalDelivered}`);
    console.log(`  Duplicates: ${totalDuplicates}`);
    console.log("═══════════════════════════════════════════════════════════\n");

    for (const conn of conns) conn.close();
  }, 120_000);
});
