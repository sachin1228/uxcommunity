/**
 * PERF 1-3: Basic latency and burst traffic tests.
 * Each test has its own room/community — safe to share a worker instance.
 *
 * Room ownership: every subscriber connects to the COMMUNITY room it measures
 * (see ./helpers/realtime-harness.ts). An earlier revision attached each
 * subscriber to `user:${id}` instead, which parked it in a UserDO that a
 * `chat:*` publish never targets — the suite then reported 0/500 deliveries
 * while still "passing", because it asserted nothing.
 *
 * Note on HTTP latency: `/publish` now fans out inside `ctx.waitUntil()` at
 * bounded concurrency, so the HTTP response is an enqueue ack, not a delivery
 * ack. End-to-end (publish → client receive) is the meaningful metric; the HTTP
 * number is reported only to show the caller is no longer blocked by fan-out.
 *
 * Run: npx vitest run __tests__/perf-latency-burst.test.ts --reporter=verbose
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startHarness,
  type Harness,
  sleep,
  measureDeliveries,
  reportLatency,
  closeAll,
} from "./helpers/realtime-harness";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
}, 30_000);

afterAll(async () => {
  await harness?.stop();
});

// ============================================================================
// PERF 1: 500 active subscribers — corrected latency
// ============================================================================

describe("PERF 1: 500 subscribers — corrected latency", () => {
  it("measures end-to-end latency with actual client receive time", async () => {
    const N = 500;
    const connectStart = performance.now();
    const conns = await harness.connectBatch("p1", N, "chat:p1", "chat");
    const connectMs = performance.now() - connectStart;
    await sleep(2000);

    const publishTs = performance.now();
    const { status, ms: httpLatency } = await harness.publish("chat:p1", "chat", { seq: 1 });
    await sleep(10000);

    const { delivered, duplicates, latencies } = measureDeliveries(
      conns,
      (m) => m.data?.seq === 1,
      publishTs,
    );

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 1: 500 subscribers — corrected latency");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Connect + subscribe setup: ${connectMs.toFixed(0)}ms`);
    console.log(`  HTTP status: ${status}`);
    console.log(`  HTTP /publish response time: ${httpLatency.toFixed(1)}ms`);
    console.log(`  Delivered: ${delivered}/${N}`);
    console.log(`  Failed RPCs: ${N - delivered}`);
    reportLatency("End-to-end (T0=publish, T1=client receive)", latencies);
    console.log("═══════════════════════════════════════════════════════════\n");

    expect(status).toBe(200);
    expect(delivered).toBe(N);
    expect(duplicates).toBe(0);

    closeAll(conns);
  }, 180_000);
});

// ============================================================================
// PERF 2: Burst traffic — 10 messages × 500 subscribers
// ============================================================================

describe("PERF 2: Burst — 10 messages × 500 subscribers", () => {
  it("measures latency for rapid sequential publishes", async () => {
    const N = 500;
    const MESSAGES = 10;
    const connectStart = performance.now();
    const conns = await harness.connectBatch("p2", N, "chat:p2", "chat");
    const connectMs = performance.now() - connectStart;
    await sleep(2000);

    const allLatencies: number[] = [];
    const httpLatencies: number[] = [];
    const publishTsBySeq: number[] = [];

    for (let seq = 0; seq < MESSAGES; seq++) {
      publishTsBySeq[seq] = performance.now();
      const { ms: httpMs } = await harness.publish("chat:p2", "chat", { seq });
      httpLatencies.push(httpMs);
      await sleep(1000);
    }

    // `/publish` acknowledges the enqueue (fan-out runs in ctx.waitUntil), so
    // let the burst finish rather than sampling against a fixed window — a
    // message whose tail crossed the window boundary would be scored as lost.
    await sleep(5000);

    let deliveredTotal = 0;
    let duplicatesTotal = 0;
    for (let seq = 0; seq < MESSAGES; seq++) {
      const report = measureDeliveries(conns, (m) => m.data?.seq === seq, publishTsBySeq[seq]);
      deliveredTotal += report.delivered;
      duplicatesTotal += report.duplicates;
      allLatencies.push(...report.latencies);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 2: Burst — 10 messages × 500 subscribers");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Connect + subscribe setup: ${connectMs.toFixed(0)}ms`);
    console.log(`  Expected deliveries: ${MESSAGES * N}`);
    console.log(`  Actual deliveries: ${deliveredTotal}`);
    console.log(`  Missing: ${MESSAGES * N - deliveredTotal}`);
    console.log(`  Duplicates: ${duplicatesTotal}`);
    reportLatency("HTTP /publish response", httpLatencies);
    reportLatency("End-to-end delivery", allLatencies);
    console.log("═══════════════════════════════════════════════════════════\n");

    expect(deliveredTotal).toBe(MESSAGES * N);
    expect(duplicatesTotal).toBe(0);

    closeAll(conns);
  }, 300_000);
});

// ============================================================================
// PERF 3: Burst traffic — 100 messages × 500 subscribers
// ============================================================================

describe("PERF 3: Burst — 100 messages × 500 subscribers", () => {
  it("no duplicates, no missing events at high volume", async () => {
    const N = 500;
    const MESSAGES = 100;
    const connectStart = performance.now();
    const conns = await harness.connectBatch("p3", N, "chat:p3", "chat");
    const connectMs = performance.now() - connectStart;
    await sleep(2000);

    const allLatencies: number[] = [];
    const publishTsBySeq: number[] = [];

    for (let seq = 0; seq < MESSAGES; seq++) {
      publishTsBySeq[seq] = performance.now();
      await harness.publish("chat:p3", "chat", { seq });
      await sleep(200);
    }

    // Drain before sampling: a 500-recipient fan-out can take longer than the
    // 200ms gap between publishes, and `/publish` only acks the enqueue.
    await sleep(10000);

    let deliveredTotal = 0;
    let duplicates = 0;
    for (let seq = 0; seq < MESSAGES; seq++) {
      const report = measureDeliveries(conns, (m) => m.data?.seq === seq, publishTsBySeq[seq]);
      deliveredTotal += report.delivered;
      duplicates += report.duplicates;
      allLatencies.push(...report.latencies);
    }

    const expected = MESSAGES * N;
    const actual = deliveredTotal;

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 3: Burst — 100 messages × 500 subscribers");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Connect + subscribe setup: ${connectMs.toFixed(0)}ms`);
    console.log(`  Expected deliveries: ${expected}`);
    console.log(`  Actual deliveries:   ${actual}`);
    console.log(`  Missing:             ${expected - actual}`);
    console.log(`  Duplicates:          ${duplicates}`);
    reportLatency("End-to-end delivery", allLatencies);
    console.log("═══════════════════════════════════════════════════════════\n");

    expect(actual).toBe(expected);
    expect(duplicates).toBe(0);

    closeAll(conns);
  }, 300_000);
});
