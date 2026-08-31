/**
 * FINAL RPC FAN-OUT TEST
 *
 * Verifies exact delivery counts and zero duplicates:
 *   500 subscribers × 1 message  → 500/500, 0 duplicates
 *   500 subscribers × 10 messages → 5000/5000, 0 duplicates
 *   500 subscribers × 100 messages → 50000/50000, 0 duplicates
 *
 * Run: npx vitest run __tests__/perf-fanout-final.test.ts --reporter=verbose
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

function waitForMessage(messages: any[], type: string, ms = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const msg = messages.find((m) => m.t === type);
      if (msg) return resolve(msg);
      if (Date.now() - start > ms) return reject(new Error(`Timeout waiting for ${type}`));
      setTimeout(check, 50);
    };
    check();
  });
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
// FAN-OUT 1: 500 subscribers × 1 message
// ============================================================================

describe("Fan-out: 500 × 1", () => {
  it("500/500 delivered, 0 duplicates, 0 failed RPCs", async () => {
    const N = 500;
    const MESSAGES = 1;
    const conns = await connectBatch("fo1", N, "chat:fo1", "chat");
    await new Promise((r) => setTimeout(r, 2000));

    const publishTs = performance.now();
    await fetch(`${baseUrl}/publish`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-realtime-publish-secret": PUBLISH_SECRET,
      },
      body: JSON.stringify({ room: "chat:fo1", topic: "chat", data: { seq: 0 } }),
    });
    await new Promise((r) => setTimeout(r, 10000));

    let delivered = 0;
    let duplicates = 0;
    const latencies: number[] = [];

    for (const conn of conns) {
      const events = conn.messages.filter((m) => m.t === "event" && m.data?.seq === 0);
      if (events.length > 0) {
        delivered++;
        latencies.push(events[0]._recvMs - publishTs);
      }
      if (events.length > 1) duplicates += events.length - 1;
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
    const p99 = latencies[Math.floor(latencies.length * 0.99)] ?? 0;

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  Fan-out: 500 subscribers × 1 message");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Delivered: ${delivered}/${N}`);
    console.log(`  Duplicates: ${duplicates}`);
    console.log(`  Failed RPCs: ${N - delivered}`);
    console.log(`  Latency: P50=${p50.toFixed(1)}ms  P95=${p95.toFixed(1)}ms  P99=${p99.toFixed(1)}ms`);
    console.log("═══════════════════════════════════════════════════════════\n");

    expect(delivered).toBe(N);
    expect(duplicates).toBe(0);

    for (const conn of conns) conn.close();
  }, 120_000);
});

// ============================================================================
// FAN-OUT 2: 500 subscribers × 10 messages
// ============================================================================

describe("Fan-out: 500 × 10", () => {
  it("5000/5000 delivered, 0 duplicates", async () => {
    const N = 500;
    const MESSAGES = 10;
    const conns = await connectBatch("fo2", N, "chat:fo2", "chat");
    await new Promise((r) => setTimeout(r, 2000));

    let totalDelivered = 0;
    let totalDuplicates = 0;
    const allLatencies: number[] = [];

    for (let seq = 0; seq < MESSAGES; seq++) {
      const publishTs = performance.now();
      await fetch(`${baseUrl}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-realtime-publish-secret": PUBLISH_SECRET,
        },
        body: JSON.stringify({ room: "chat:fo2", topic: "chat", data: { seq } }),
      });
      await new Promise((r) => setTimeout(r, 1000));

      for (const conn of conns) {
        const events = conn.messages.filter((m) => m.t === "event" && m.data?.seq === seq);
        if (events.length > 0) {
          totalDelivered++;
          allLatencies.push(events[0]._recvMs - publishTs);
        }
        if (events.length > 1) totalDuplicates += events.length - 1;
      }
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  Fan-out: 500 subscribers × 10 messages");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Expected: ${MESSAGES * N}`);
    console.log(`  Delivered: ${totalDelivered}`);
    console.log(`  Duplicates: ${totalDuplicates}`);
    console.log("═══════════════════════════════════════════════════════════\n");

    expect(totalDelivered).toBe(MESSAGES * N);
    expect(totalDuplicates).toBe(0);

    for (const conn of conns) conn.close();
  }, 120_000);
});

// ============================================================================
// FAN-OUT 3: 500 subscribers × 100 messages
// ============================================================================

describe("Fan-out: 500 × 100", () => {
  it("50000/50000 delivered, 0 duplicates", async () => {
    const N = 500;
    const MESSAGES = 100;
    const conns = await connectBatch("fo3", N, "chat:fo3", "chat");
    await new Promise((r) => setTimeout(r, 2000));

    let totalDelivered = 0;
    let totalDuplicates = 0;

    for (let seq = 0; seq < MESSAGES; seq++) {
      await fetch(`${baseUrl}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-realtime-publish-secret": PUBLISH_SECRET,
        },
        body: JSON.stringify({ room: "chat:fo3", topic: "chat", data: { seq } }),
      });
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

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  Fan-out: 500 subscribers × 100 messages");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Expected: ${MESSAGES * N}`);
    console.log(`  Delivered: ${totalDelivered}`);
    console.log(`  Duplicates: ${totalDuplicates}`);
    console.log("═══════════════════════════════════════════════════════════\n");

    expect(totalDelivered).toBe(MESSAGES * N);
    expect(totalDuplicates).toBe(0);

    for (const conn of conns) conn.close();
  }, 180_000);
});
