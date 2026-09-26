/**
 * Subscriber index benchmark — measures the CommunityDO's topic index directly
 * through real WebSocket subscribers and asserts exact recipient counts.
 *
 * WHAT WAS WRONG
 *   The previous revision populated the "index" by having each synthetic user
 *   open a socket to `user:${userId}` and then send `subscribe { room: "chat:…" }`.
 *   Those subscriptions land in that user's UserDO — a different Durable Object
 *   than the one `chat:…` publishes target — so the benchmark measured an index
 *   nobody publishes to, `/publish` delivered to nothing, and nothing was
 *   asserted. It also reported the HTTP `/publish` round-trip as if it measured
 *   fan-out; since `/publish` now enqueues the fan-out in `ctx.waitUntil()`,
 *   that number is an ack, not a delivery.
 *
 * WHAT IT MEASURES NOW
 *   1. head-to-head index sizes — 10K vs 100K indexed subscription refs — with
 *      the SAME 100 active chat recipients, so the only variable is index size;
 *   2. that a publish reaches exactly those 100 recipients (no full scan, no
 *      cross-topic delivery), asserted from client receipt AND from the DO's own
 *      `deliverAttempts` counter;
 *   3. end-to-end delivery latency for both, which is the number that would
 *      blow up if lookup were O(index) instead of O(1) + O(recipients).
 *
 * Run: npx vitest run __tests__/perf-index-benchmark.test.ts --reporter=verbose
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startHarness,
  type Harness,
  type Conn,
  sleep,
  measureDeliveries,
  countForeignEvents,
  measureFanout,
  percentile,
} from "./helpers/realtime-harness";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
}, 30_000);

afterAll(async () => {
  await harness?.stop();
});

// ── Benchmark parameters ────────────────────────────────────────────────────

const SOCKETS = 500;
const ACTIVE_CHAT = 100;
const PUBLISH_CYCLES = 10;
const CHAT_TOPIC = "chat";
const bulkTopic = (j: number) => `bulk_${j}`;

interface BenchResult {
  room: string;
  indexRefs: number;
  indexedTopics: number;
  recipients: number;
  delivered: number;
  duplicates: number;
  leaked: number;
  attempts: number;
  /** `false` if a DO instance replacement landed inside the measurement window. */
  sameInstance: boolean;
  instanceIds: string;
  setupMs: number;
  publishMs: number;
  httpLatencies: number[];
  deliveryLatencies: number[];
}

async function runBenchmark(
  prefix: string,
  room: string,
  topicsPerSocket: number,
  refTimeoutMs: number,
): Promise<BenchResult> {
  const setupStart = performance.now();
  const conns: Conn[] = [];

  for (let i = 0; i < SOCKETS; i++) {
    const conn = await harness.connect(room, `${prefix}_${i}`);
    const isChatSubscriber = i < ACTIVE_CHAT;
    if (isChatSubscriber) harness.subscribe(conn, room, CHAT_TOPIC);
    const bulkCount = topicsPerSocket - (isChatSubscriber ? 1 : 0);
    for (let j = 0; j < bulkCount; j++) harness.subscribe(conn, room, bulkTopic(j));
    conns.push(conn);
  }

  const expectedRefs = SOCKETS * topicsPerSocket;
  const ready = await harness.waitForRefs(room, expectedRefs, refTimeoutMs);
  // Let the coalesced presence flush settle so it cannot pollute the metrics delta.
  await sleep(1000);
  const setupMs = performance.now() - setupStart;

  const chatSubscribers = conns.slice(0, ACTIVE_CHAT);
  const otherSockets = conns.slice(ACTIVE_CHAT);

  const httpLatencies: number[] = [];

  // All cycles publish inside ONE tight measurement window (baseline → publish
  // cycles → counters), then arrivals are sampled. Reading the counters after a
  // long gap is a different measurement: they belong to a DO instance, and a
  // replacement reports a delta of 0 for a fan-out that did happen.
  const win = await measureFanout(harness, room, CHAT_TOPIC, async (publish) => {
    for (let cycle = 0; cycle < PUBLISH_CYCLES; cycle++) {
      const { status, ms } = await publish({ cycle });
      httpLatencies.push(ms);
      expect(status).toBe(200);
      await sleep(300);
    }
  });
  const publishMs = win.publishedAt[win.publishedAt.length - 1] - win.publishedAt[0];

  const deliveryLatencies: number[] = [];
  let delivered = 0;
  let duplicates = 0;
  let leaked = 0;
  for (let cycle = 0; cycle < PUBLISH_CYCLES; cycle++) {
    const report = measureDeliveries(
      chatSubscribers,
      (m) => m.data?._run === win.runTag && m.data?.cycle === cycle,
      win.publishedAt[cycle],
    );
    delivered += report.delivered;
    duplicates += report.duplicates;
    leaked += countForeignEvents(
      otherSockets,
      (m) => m.data?._run === win.runTag && m.data?.cycle === cycle,
    );
    deliveryLatencies.push(...report.latencies);
  }

  const attempts = win.attempts;
  const sameInstance = win.sameInstance;
  const instanceIds = `${win.before.instanceId} → ${win.after.instanceId}`;

  for (const conn of conns) conn.close();
  await sleep(500);

  return {
    room,
    indexRefs: ready.subscriptionRefs,
    indexedTopics: ready.topics ?? 0,
    recipients: ACTIVE_CHAT,
    delivered,
    duplicates,
    leaked,
    attempts,
    sameInstance,
    instanceIds,
    setupMs,
    publishMs,
    httpLatencies,
    deliveryLatencies,
  };
}

function reportBenchmark(label: string, r: BenchResult, expectedRefs: number): void {
  const sortLat = [...r.deliveryLatencies].sort((a, b) => a - b);
  const sortHttp = [...r.httpLatencies].sort((a, b) => a - b);
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log(`  ${label}`);
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Room: ${r.room}`);
  console.log(`  Live sockets: ${SOCKETS}   Topics per socket: ${expectedRefs / SOCKETS}`);
  console.log(`  Indexed subscriptions: ${r.indexRefs}/${expectedRefs} across ${r.indexedTopics} topics`);
  console.log(`  Setup (connect + subscribe + index build): ${r.setupMs.toFixed(0)}ms`);
  console.log(`  Active chat recipients: ${r.recipients}`);
  console.log(`  Publish cycles: ${PUBLISH_CYCLES}`);
  console.log(
    `  Delivered: ${r.delivered}/${r.recipients * PUBLISH_CYCLES}  duplicates: ${r.duplicates}  leaked: ${r.leaked}`,
  );
  console.log(
    `  DO deliverAttempts: ${r.attempts} (exactly ${r.recipients} per publish, no full-room scan)`,
  );
  console.log(
    `  DO instance across the measurement window: ${r.instanceIds} (one instance: ${r.sameInstance})`,
  );
  console.log(
    `  End-to-end delivery latency: P50=${percentile(sortLat, 50).toFixed(1)}ms  P95=${percentile(sortLat, 95).toFixed(1)}ms  max=${(sortLat[sortLat.length - 1] ?? 0).toFixed(1)}ms`,
  );
  console.log(
    `  HTTP /publish ack latency:    P50=${percentile(sortHttp, 50).toFixed(1)}ms  P95=${percentile(sortHttp, 95).toFixed(1)}ms`,
  );
  console.log("═══════════════════════════════════════════════════════════");
}

// ============================================================================
// BENCHMARK 1: 10K subscription refs, 100 active chat recipients
// ============================================================================

describe("Index benchmark: 10K subscriptions", () => {
  it("10K indexed subscriptions, 100 active chat recipients", async () => {
    const expectedRefs = 10_000;
    const result = await runBenchmark("idx10k", "chat:bench_10k", expectedRefs / SOCKETS, 120_000);
    reportBenchmark("Index benchmark: 10K subscription refs, 100 active chat", result, expectedRefs);

    expect(result.indexRefs).toBe(expectedRefs);
    expect(result.delivered).toBe(ACTIVE_CHAT * PUBLISH_CYCLES);
    expect(result.duplicates).toBe(0);
    expect(result.leaked).toBe(0);
    expect(result.attempts).toBe(ACTIVE_CHAT * PUBLISH_CYCLES);
    expect(result.sameInstance).toBe(true);
  }, 600_000);
});

// ============================================================================
// BENCHMARK 2: 100K subscription refs, 100 active chat recipients
// ============================================================================

describe("Index benchmark: 100K subscriptions", () => {
  it("100K indexed subscriptions, same 100 active chat recipients", async () => {
    const expectedRefs = 100_000;
    const result = await runBenchmark("idx100k", "chat:bench_100k", expectedRefs / SOCKETS, 300_000);
    reportBenchmark("Index benchmark: 100K subscription refs, 100 active chat", result, expectedRefs);

    expect(result.indexRefs).toBe(expectedRefs);
    expect(result.delivered).toBe(ACTIVE_CHAT * PUBLISH_CYCLES);
    expect(result.duplicates).toBe(0);
    expect(result.leaked).toBe(0);
    expect(result.attempts).toBe(ACTIVE_CHAT * PUBLISH_CYCLES);
    expect(result.sameInstance).toBe(true);

    // Tripwire, not a target: if lookup or fan-out were proportional to the
    // 100K index instead of its 100 recipients, one publish would take seconds.
    const sorted = [...result.deliveryLatencies].sort((a, b) => a - b);
    expect(percentile(sorted, 50)).toBeLessThan(2000);
  }, 900_000);
});
