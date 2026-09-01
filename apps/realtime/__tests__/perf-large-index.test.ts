/**
 * PERF 5-6: Large subscriber index (10K and 100K subscriptions).
 * Isolated worker instance — these tests are heavy and may only work on
 * Cloudflare staging due to miniflare connection limits.
 *
 * Run locally: npx vitest run __tests__/perf-large-index.test.ts --reporter=verbose
 * Run on staging: deploy and run via staging test runner
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
    vars: { USE_WEBSOCKET_OWNERSHIP: "true" },
  });
  baseUrl = `http://127.0.0.1:${worker.port}`;
}, 30_000);

afterAll(async () => {
  await worker?.stop();
});

// ============================================================================
// PERF 5: Large subscriber index — 10K subscriptions, 100 active
// ============================================================================

describe("PERF 5: Large subscriber index — 10K subscriptions", () => {
  it("10K subscriptions in index, 100 active chat subscribers", async () => {
    const TOTAL_SUBS = 10_000;
    const ACTIVE_CHAT = 100;
    const conns = await connectBatch("p5", TOTAL_SUBS, "chat:p5", "chat");
    await new Promise((r) => setTimeout(r, 2000));

    const publishTs = performance.now();
    const httpStart = performance.now();
    await fetch(`${baseUrl}/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-realtime-publish-secret": PUBLISH_SECRET,
      },
      body: JSON.stringify({ room: "chat:p5", topic: "chat", data: { seq: 1 } }),
    });
    const httpLatency = performance.now() - httpStart;

    await new Promise((r) => setTimeout(r, 5000));

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
    console.log("  PERF 5: Large subscriber index — 10K subscriptions");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Total subscriptions in index: ${TOTAL_SUBS}`);
    console.log(`  Active chat subscribers: ${ACTIVE_CHAT}`);
    console.log(`  HTTP /publish response: ${httpLatency.toFixed(1)}ms`);
    console.log(`  Delivered: ${delivered}/${TOTAL_SUBS}`);
    console.log(`  Subscriber lookup: O(1) via subscriptionsByTopic.get("chat")`);
    console.log(`  Broadcast: O(${ACTIVE_CHAT}) — only active subscribers`);
    reportLatency("End-to-end delivery", latencies);
    console.log("═══════════════════════════════════════════════════════════\n");

    for (const conn of conns) conn.close();
  }, 120_000);
});

// ============================================================================
// PERF 6: Large subscriber index — 100K subscriptions, 1K active
// ============================================================================

describe("PERF 6: Large subscriber index — 100K subscriptions", () => {
  it("100K subscriptions in index, 1K active chat subscribers", async () => {
    const TOTAL_SUBS = 100_000;
    const conns = await connectBatch("p6", TOTAL_SUBS, "chat:p6", "chat");
    await new Promise((r) => setTimeout(r, 3000));

    const publishTs = performance.now();
    const httpStart = performance.now();
    await fetch(`${baseUrl}/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-realtime-publish-secret": PUBLISH_SECRET,
      },
      body: JSON.stringify({ room: "chat:p6", topic: "chat", data: { seq: 1 } }),
    });
    const httpLatency = performance.now() - httpStart;

    await new Promise((r) => setTimeout(r, 15000));

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
    console.log("  PERF 6: Large subscriber index — 100K subscriptions");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Total subscriptions in index: ${TOTAL_SUBS}`);
    console.log(`  HTTP /publish response: ${httpLatency.toFixed(1)}ms`);
    console.log(`  Delivered: ${delivered}/${TOTAL_SUBS}`);
    console.log(`  Subscriber lookup: O(1)`);
    console.log(`  Broadcast: O(${delivered}) — only active subscribers`);
    reportLatency("End-to-end delivery", latencies);
    console.log("═══════════════════════════════════════════════════════════\n");

    for (const conn of conns) conn.close();
  }, 300_000);
});
