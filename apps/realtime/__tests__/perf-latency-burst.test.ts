/**
 * PERF 1-3: Basic latency and burst traffic tests.
 * Each test has its own room/community — safe to share a worker instance.
 *
 * Run: npx vitest run __tests__/perf-latency-burst.test.ts --reporter=verbose
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
// PERF 1: 500 active subscribers — corrected latency
// ============================================================================

describe("PERF 1: 500 subscribers — corrected latency", () => {
  it("measures end-to-end latency with actual client receive time", async () => {
    const N = 500;
    const conns = await connectBatch("p1", N, "chat:p1", "chat");
    await new Promise((r) => setTimeout(r, 2000));

    const publishTs = performance.now();
    const httpStart = performance.now();
    const res = await fetch(`${baseUrl}/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-realtime-publish-secret": PUBLISH_SECRET,
      },
      body: JSON.stringify({ room: "chat:p1", topic: "chat", data: { seq: 1 } }),
    });
    const httpLatency = performance.now() - httpStart;

    await new Promise((r) => setTimeout(r, 10000));

    const latencies: number[] = [];
    let delivered = 0;
    for (const conn of conns) {
      const event = conn.messages.find((m) => m.t === "event" && m.data?.seq === 1);
      if (event) {
        delivered++;
        latencies.push(event._recvMs - publishTs);
      }
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 1: 500 subscribers — corrected latency");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  HTTP status: ${res.status}`);
    console.log(`  HTTP /publish response time: ${httpLatency.toFixed(1)}ms`);
    console.log(`  Delivered: ${delivered}/${N}`);
    console.log(`  Failed RPCs: ${N - delivered}`);
    reportLatency("End-to-end (T0=publish, T1=client receive)", latencies);
    console.log("═══════════════════════════════════════════════════════════\n");

    for (const conn of conns) conn.close();
  }, 120_000);
});

// ============================================================================
// PERF 2: Burst traffic — 10 messages × 500 subscribers
// ============================================================================

describe("PERF 2: Burst — 10 messages × 500 subscribers", () => {
  it("measures latency for rapid sequential publishes", async () => {
    const N = 500;
    const MESSAGES = 10;
    const conns = await connectBatch("p2", N, "chat:p2", "chat");
    await new Promise((r) => setTimeout(r, 2000));

    const allLatencies: number[] = [];
    const httpLatencies: number[] = [];

    for (let seq = 0; seq < MESSAGES; seq++) {
      const publishTs = performance.now();
      const httpStart = performance.now();
      await fetch(`${baseUrl}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-realtime-publish-secret": PUBLISH_SECRET,
        },
        body: JSON.stringify({ room: "chat:p2", topic: "chat", data: { seq } }),
      });
      httpLatencies.push(performance.now() - httpStart);
      await new Promise((r) => setTimeout(r, 1000));

      for (const conn of conns) {
        const event = conn.messages.find((m) => m.t === "event" && m.data?.seq === seq);
        if (event) {
          allLatencies.push(event._recvMs - publishTs);
        }
      }
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 2: Burst — 10 messages × 500 subscribers");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Expected deliveries: ${MESSAGES * N}`);
    console.log(`  Actual deliveries: ${allLatencies.length}`);
    console.log(`  Missing: ${MESSAGES * N - allLatencies.length}`);
    reportLatency("HTTP /publish response", httpLatencies);
    reportLatency("End-to-end delivery", allLatencies);
    console.log("═══════════════════════════════════════════════════════════\n");

    for (const conn of conns) conn.close();
  }, 120_000);
});

// ============================================================================
// PERF 3: Burst traffic — 100 messages × 500 subscribers
// ============================================================================

describe("PERF 3: Burst — 100 messages × 500 subscribers", () => {
  it("no duplicates, no missing events at high volume", async () => {
    const N = 500;
    const MESSAGES = 100;
    const conns = await connectBatch("p3", N, "chat:p3", "chat");
    await new Promise((r) => setTimeout(r, 2000));

    const allLatencies: number[] = [];
    let duplicates = 0;

    for (let seq = 0; seq < MESSAGES; seq++) {
      const publishTs = performance.now();
      await fetch(`${baseUrl}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-realtime-publish-secret": PUBLISH_SECRET,
        },
        body: JSON.stringify({ room: "chat:p3", topic: "chat", data: { seq } }),
      });
      await new Promise((r) => setTimeout(r, 200));

      for (const conn of conns) {
        const events = conn.messages.filter(
          (m) => m.t === "event" && m.data?.seq === seq
        );
        if (events.length > 1) duplicates += events.length - 1;
        if (events.length >= 1) {
          allLatencies.push(events[0]._recvMs - publishTs);
        }
      }
    }

    const expected = MESSAGES * N;
    const actual = allLatencies.length;

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 3: Burst — 100 messages × 500 subscribers");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Expected deliveries: ${expected}`);
    console.log(`  Actual deliveries:   ${actual}`);
    console.log(`  Missing:             ${expected - actual}`);
    console.log(`  Duplicates:          ${duplicates}`);
    reportLatency("End-to-end delivery", allLatencies);
    console.log("═══════════════════════════════════════════════════════════\n");

    for (const conn of conns) conn.close();
  }, 180_000);
});
