/**
 * PERF 4: Multiple hot communities — 3 × 500 subscribers.
 * Isolated worker instance to avoid miniflare overload.
 *
 * Run: npx vitest run __tests__/perf-hot-communities.test.ts --reporter=verbose
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
// PERF 4: Multiple hot communities — 3 × 500
// ============================================================================

describe("PERF 4: Multiple hot communities — 3 × 500", () => {
  it("concurrent publishes to 3 communities, no cross-leakage", async () => {
    const N = 500;
    const comms = ["chat:p4_A", "chat:p4_B", "chat:p4_C"];
    const connsPerComm: Array<{ ws: WebSocket; messages: any[]; close: () => void }>[] = [];

    for (const comm of comms) {
      const conns = await connectBatch(`p4_${comm}`, N, comm, "chat");
      connsPerComm.push(conns);
    }
    await new Promise((r) => setTimeout(r, 2000));

    const publishTs = performance.now();
    await Promise.all(comms.map((comm) =>
      fetch(`${baseUrl}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-realtime-publish-secret": PUBLISH_SECRET,
        },
        body: JSON.stringify({ room: comm, topic: "chat", data: { from: comm } }),
      })
    ));
    await new Promise((r) => setTimeout(r, 5000));

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 4: Multiple hot communities — 3 × 500");
    console.log("═══════════════════════════════════════════════════════════");

    for (let ci = 0; ci < comms.length; ci++) {
      const comm = comms[ci];
      const conns = connsPerComm[ci];
      let delivered = 0;
      let leaked = 0;
      const latencies: number[] = [];

      for (const conn of conns) {
        const event = conn.messages.find(
          (m) => m.t === "event" && m.data?.from === comm
        );
        if (event) {
          delivered++;
          latencies.push(event._recvMs - publishTs);
        }
        const leak = conn.messages.find(
          (m) => m.t === "event" && m.data?.from && m.data.from !== comm
        );
        if (leak) leaked++;
      }

      console.log(`  ${comm}: delivered=${delivered}/${N}  leaked=${leaked}`);
      reportLatency(`  ${comm} latency`, latencies);
    }
    console.log("═══════════════════════════════════════════════════════════\n");

    for (const conns of connsPerComm) {
      for (const conn of conns) conn.close();
    }
  }, 120_000);
});
