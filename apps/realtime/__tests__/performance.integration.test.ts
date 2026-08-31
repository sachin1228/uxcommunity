/**
 * Performance benchmarks for the RPC-based realtime system.
 *
 * Measures:
 *   - Publish latency (HTTP /publish response time)
 *   - End-to-end delivery latency (publish → client receive)
 *   - Subscriber lookup time (dual-index)
 *   - RPC call throughput
 *   - p50 / p95 / p99 latency
 *   - Failed RPC count
 *
 * Run: npx vitest run __tests__/performance.integration.test.ts --reporter=verbose
 *
 * NOTE: These are local dev benchmarks. Production performance will differ
 * due to network latency, DO hibernation, and Cloudflare edge routing.
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

function waitForMessage(messages: any[], type: string, ms = 10000): Promise<any> {
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

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
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
// PERF 1: 500 active subscribers — publish latency
// ============================================================================

describe("Performance: 500 active subscribers", () => {
  it("measures publish latency and delivery time", async () => {
    const CLIENT_COUNT = 500;
    const conns: Array<{ ws: WebSocket; messages: any[]; close: () => void }> = [];
    const deliveryLatencies: number[] = [];
    let failedRpcCount = 0;

    try {
      // Phase 1: Connect all clients
      const connectStart = Date.now();
      for (let i = 0; i < CLIENT_COUNT; i++) {
        const token = await createToken(`perf_500_${i}`);
        const conn = connectWs(`user:perf_500_${i}`, token);
        conns.push(conn);
        await waitForOpen(conn.ws);
        conn.ws.send(JSON.stringify({
          t: "join", user: { id: `perf_500_${i}`, name: `U${i}`, avatar: null },
        }));
        await waitForMessage(conn.messages, "hello");
        conn.ws.send(JSON.stringify({
          t: "subscribe", room: "chat:perf_comm_500", topic: "chat",
        }));
      }
      const connectTime = Date.now() - connectStart;

      // Wait for all subscriptions to propagate
      await new Promise((r) => setTimeout(r, 2000));

      // Phase 2: Publish and measure
      const publishStart = Date.now();
      const publishTs = performance.now();

      const publishRes = await fetch(`${baseUrl}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-realtime-publish-secret": PUBLISH_SECRET,
        },
        body: JSON.stringify({
          room: "chat:perf_comm_500",
          topic: "chat",
          data: { ts: publishTs, seq: 1 },
        }),
      });

      const publishHttpStatus = publishRes.status;
      const publishHttpTime = performance.now() - publishTs;

      // Wait for all deliveries
      await new Promise((r) => setTimeout(r, 10000));
      const totalElapsed = performance.now() - publishTs;

      // Collect per-client delivery latencies
      for (const conn of conns) {
        const event = conn.messages.find(
          (m) => m.t === "event" && m.data?.seq === 1
        );
        if (event) {
          deliveryLatencies.push(event._recvMs - publishTs);
        } else {
          failedRpcCount++;
        }
      }

      // Sort for percentile calculation
      deliveryLatencies.sort((a, b) => a - b);

      const delivered = deliveryLatencies.length;
      const p50 = percentile(deliveryLatencies, 50);
      const p95 = percentile(deliveryLatencies, 95);
      const p99 = percentile(deliveryLatencies, 99);
      const min = deliveryLatencies[0] ?? 0;
      const max = deliveryLatencies[deliveryLatencies.length - 1] ?? 0;
      const avg = deliveryLatencies.length > 0
        ? deliveryLatencies.reduce((a, b) => a + b, 0) / deliveryLatencies.length
        : 0;

      console.log("\n═══════════════════════════════════════════════════════════");
      console.log("  PERFORMANCE: 500 active subscribers");
      console.log("═══════════════════════════════════════════════════════════");
      console.log(`  Connect time:          ${connectTime}ms`);
      console.log(`  HTTP publish status:   ${publishHttpStatus}`);
      console.log(`  HTTP publish latency:  ${publishHttpTime.toFixed(2)}ms`);
      console.log(`  Total elapsed:         ${totalElapsed.toFixed(2)}ms`);
      console.log(`  Delivered:             ${delivered}/${CLIENT_COUNT}`);
      console.log(`  Failed RPCs:           ${failedRpcCount}`);
      console.log(`  ─────────────────────────────────────`);
      console.log(`  Delivery latency (publish → client receive):`);
      console.log(`    Min:     ${min.toFixed(2)}ms`);
      console.log(`    Avg:     ${avg.toFixed(2)}ms`);
      console.log(`    P50:     ${p50.toFixed(2)}ms`);
      console.log(`    P95:     ${p95.toFixed(2)}ms`);
      console.log(`    P99:     ${p99.toFixed(2)}ms`);
      console.log(`    Max:     ${max.toFixed(2)}ms`);
      console.log(`  ─────────────────────────────────────`);
      console.log(`  O(active subscribers): ${CLIENT_COUNT}`);
      console.log(`  O(total community):    N/A (no member list scan)`);
      console.log("═══════════════════════════════════════════════════════════\n");

      // Verify all delivered
      if (delivered < CLIENT_COUNT) {
        console.warn(`  WARNING: ${CLIENT_COUNT - delivered} clients did NOT receive the event`);
      }
    } finally {
      for (const conn of conns) conn.close();
    }
  }, 120_000);
});

// ============================================================================
// PERF 2: 500 subscribers — multiple publishes
// ============================================================================

describe("Performance: 500 subscribers — multiple publishes", () => {
  it("measures latency across 10 sequential publishes", async () => {
    const CLIENT_COUNT = 500;
    const PUBLISH_COUNT = 10;
    const conns: Array<{ ws: WebSocket; messages: any[]; close: () => void }> = [];

    try {
      // Connect all clients
      for (let i = 0; i < CLIENT_COUNT; i++) {
        const token = await createToken(`perf_multi_${i}`);
        const conn = connectWs(`user:perf_multi_${i}`, token);
        conns.push(conn);
        await waitForOpen(conn.ws);
        conn.ws.send(JSON.stringify({
          t: "join", user: { id: `perf_multi_${i}`, name: `U${i}`, avatar: null },
        }));
        await waitForMessage(conn.messages, "hello");
        conn.ws.send(JSON.stringify({
          t: "subscribe", room: "chat:perf_comm_multi", topic: "chat",
        }));
      }

      await new Promise((r) => setTimeout(r, 2000));

      const allLatencies: number[] = [];

      for (let seq = 0; seq < PUBLISH_COUNT; seq++) {
        const publishTs = performance.now();

        await fetch(`${baseUrl}/publish`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-realtime-publish-secret": PUBLISH_SECRET,
          },
          body: JSON.stringify({
            room: "chat:perf_comm_multi",
            topic: "chat",
            data: { ts: publishTs, seq },
          }),
        });

        await new Promise((r) => setTimeout(r, 2000));

        // Collect latencies for this publish
        for (const conn of conns) {
          const event = conn.messages.find(
            (m) => m.t === "event" && m.data?.seq === seq
          );
          if (event) {
            allLatencies.push(event._recvMs - publishTs);
          }
        }
      }

      allLatencies.sort((a, b) => a - b);

      const p50 = percentile(allLatencies, 50);
      const p95 = percentile(allLatencies, 95);
      const p99 = percentile(allLatencies, 99);
      const avg = allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length;

      console.log("\n═══════════════════════════════════════════════════════════");
      console.log("  PERFORMANCE: 500 subscribers × 10 publishes");
      console.log("═══════════════════════════════════════════════════════════");
      console.log(`  Total measurements:    ${allLatencies.length}`);
      console.log(`  ─────────────────────────────────────`);
      console.log(`  Delivery latency (publish → client receive):`);
      console.log(`    Avg:     ${avg.toFixed(2)}ms`);
      console.log(`    P50:     ${p50.toFixed(2)}ms`);
      console.log(`    P95:     ${p95.toFixed(2)}ms`);
      console.log(`    P99:     ${p99.toFixed(2)}ms`);
      console.log("═══════════════════════════════════════════════════════════\n");
    } finally {
      for (const conn of conns) conn.close();
    }
  }, 120_000);
});

// ============================================================================
// PERF 3: Subscriber lookup time
// ============================================================================

describe("Performance: subscriber lookup", () => {
  it("measures time to add subscribers and look up by topic", async () => {
    const CLIENT_COUNT = 500;
    const conns: Array<{ ws: WebSocket; messages: any[]; close: () => void }> = [];

    try {
      // Connect and subscribe one at a time, measuring subscribe latency
      const subscribeLatencies: number[] = [];

      for (let i = 0; i < CLIENT_COUNT; i++) {
        const token = await createToken(`perf_lookup_${i}`);
        const conn = connectWs(`user:perf_lookup_${i}`, token);
        conns.push(conn);

        const t0 = performance.now();
        await waitForOpen(conn.ws);
        conn.ws.send(JSON.stringify({
          t: "join", user: { id: `perf_lookup_${i}`, name: `U${i}`, avatar: null },
        }));
        await waitForMessage(conn.messages, "hello");
        conn.ws.send(JSON.stringify({
          t: "subscribe", room: "chat:perf_comm_lookup", topic: "chat",
        }));
        await new Promise((r) => setTimeout(r, 50)); // Wait for RPC
        subscribeLatencies.push(performance.now() - t0);
      }

      subscribeLatencies.sort((a, b) => a - b);

      // Measure publish latency (which includes subscriber lookup)
      const publishTimes: number[] = [];
      for (let i = 0; i < 5; i++) {
        const t0 = performance.now();
        await fetch(`${baseUrl}/publish`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-realtime-publish-secret": PUBLISH_SECRET,
          },
          body: JSON.stringify({
            room: "chat:perf_comm_lookup",
            topic: "chat",
            data: { seq: i },
          }),
        });
        publishTimes.push(performance.now() - t0);
        await new Promise((r) => setTimeout(r, 500));
      }

      publishTimes.sort((a, b) => a - b);

      console.log("\n═══════════════════════════════════════════════════════════");
      console.log("  PERFORMANCE: Subscriber lookup");
      console.log("═══════════════════════════════════════════════════════════");
      console.log(`  Subscribers: ${CLIENT_COUNT}`);
      console.log(`  ─────────────────────────────────────`);
      console.log(`  Subscribe latency (per client):`);
      console.log(`    P50: ${percentile(subscribeLatencies, 50).toFixed(2)}ms`);
      console.log(`    P95: ${percentile(subscribeLatencies, 95).toFixed(2)}ms`);
      console.log(`  ─────────────────────────────────────`);
      console.log(`  /publish HTTP response time (5 publishes):`);
      console.log(`    P50: ${percentile(publishTimes, 50).toFixed(2)}ms`);
      console.log(`    P95: ${percentile(publishTimes, 95).toFixed(2)}ms`);
      console.log(`  ─────────────────────────────────────`);
      console.log(`  Lookup complexity: O(1) via subscriptionsByTopic.get(topic)`);
      console.log(`  Broadcast complexity: O(active subscribers for topic)`);
      console.log("═══════════════════════════════════════════════════════════\n");
    } finally {
      for (const conn of conns) conn.close();
    }
  }, 120_000);
});

// ============================================================================
// PERF 4: Concurrent community publishes
// ============================================================================

describe("Performance: concurrent community publishes", () => {
  it("measures latency when 3 communities publish simultaneously", async () => {
    const CLIENTS_PER_COMM = 100;
    const conns: Array<{ ws: WebSocket; messages: any[]; close: () => void }> = [];

    try {
      // Connect clients to 3 different communities
      const communities = ["chat:perf_conc_A", "chat:perf_conc_B", "chat:perf_conc_C"];

      for (let i = 0; i < CLIENTS_PER_COMM; i++) {
        for (const comm of communities) {
          const token = await createToken(`perf_conc_${comm}_${i}`);
          const conn = connectWs(`user:perf_conc_${comm}_${i}`, token);
          conns.push(conn);
          await waitForOpen(conn.ws);
          conn.ws.send(JSON.stringify({
            t: "join", user: { id: `perf_conc_${comm}_${i}`, name: `U${i}`, avatar: null },
          }));
          await waitForMessage(conn.messages, "hello");
          conn.ws.send(JSON.stringify({ t: "subscribe", room: comm, topic: "chat" }));
        }
      }

      await new Promise((r) => setTimeout(r, 2000));

      // Publish to all 3 simultaneously
      const publishTs = performance.now();

      await Promise.all(communities.map((comm) =>
        fetch(`${baseUrl}/publish`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-realtime-publish-secret": PUBLISH_SECRET,
          },
          body: JSON.stringify({
            room: comm,
            topic: "chat",
            data: { ts: publishTs, from: comm },
          }),
        })
      ));

      await new Promise((r) => setTimeout(r, 5000));

      // Measure delivery
      let totalDelivered = 0;
      const latencies: number[] = [];

      for (const conn of conns) {
        const event = conn.messages.find(
          (m) => m.t === "event" && m.data?.from !== undefined
        );
        if (event) {
          totalDelivered++;
          latencies.push(event._recvMs - publishTs);
        }
      }

      latencies.sort((a, b) => a - b);

      console.log("\n═══════════════════════════════════════════════════════════");
      console.log("  PERFORMANCE: 3 concurrent community publishes");
      console.log("═══════════════════════════════════════════════════════════");
      console.log(`  Communities: 3 × ${CLIENTS_PER_COMM} subscribers = ${CLIENTS_PER_COMM * 3} total`);
      console.log(`  Delivered: ${totalDelivered}/${CLIENTS_PER_COMM * 3}`);
      console.log(`  P50: ${percentile(latencies, 50).toFixed(2)}ms`);
      console.log(`  P95: ${percentile(latencies, 95).toFixed(2)}ms`);
      console.log(`  P99: ${percentile(latencies, 99).toFixed(2)}ms`);
      console.log("═══════════════════════════════════════════════════════════\n");
    } finally {
      for (const conn of conns) conn.close();
    }
  }, 120_000);
});
