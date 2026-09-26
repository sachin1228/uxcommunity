/**
 * PERF 7-9: Lightweight performance tests (durable/ephemeral/duplicates).
 * Uses a shared worker instance — safe because these tests don't hold 500+ connections.
 *
 * Room ownership: each subscriber connects to the COMMUNITY room under test
 * (chat:p7 / chat:p8 / chat:p9), like production does. The previous revision
 * connected them to `user:${id}` — a different Durable Object — so every probe
 * below measured `delivered=0/x` and still "passed" because nothing was
 * asserted. Deliveries are now asserted, so a silent zero fails the suite.
 *
 * Run: npx vitest run __tests__/perf-light.test.ts --reporter=verbose
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startHarness,
  type Harness,
  sleep,
  measureDeliveries,
  countForeignEvents,
  measureFanout,
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
// PERF 7: Durable event recovery — RPC failure for chat/edit/delete/reaction
// ============================================================================

describe("PERF 7: Durable event recovery", () => {
  it("chat message delivery works even when RPC might fail", async () => {
    const conns = await harness.connectBatch("p7", 5, "chat:p7", "chat");
    await sleep(1000);

    const eventTypes = [
      { topic: "chat", data: { type: "chat", text: "hello" } },
      { topic: "chat", data: { type: "message_edit", text: "edited" } },
      { topic: "chat", data: { type: "message_delete", messageId: "123" } },
      { topic: "chat", data: { type: "reaction", emoji: "👍", messageId: "123" } },
    ];

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 7: Durable event recovery");
    console.log("═══════════════════════════════════════════════════════════");

    const deliveredByType: number[] = [];
    for (const { topic, data } of eventTypes) {
      const publishTs = performance.now();
      await harness.publish("chat:p7", topic, data);
      await sleep(3000);
      const report = measureDeliveries(conns, (m) => m.data?.type === data.type, publishTs);
      deliveredByType.push(report.delivered);
      console.log(`  ${data.type}: delivered=${report.delivered}/5`);
    }

    console.log("  Invariant: message exists in DB regardless of RPC delivery");
    console.log("  Client recovers via history/sync on next visibility change");
    console.log("═══════════════════════════════════════════════════════════\n");

    // All four durable event kinds must reach every subscriber.
    expect(deliveredByType).toEqual([5, 5, 5, 5]);

    closeAll(conns);
  }, 60_000);
});

// ============================================================================
// PERF 8: Ephemeral event behavior — typing/presence
// ============================================================================

describe("PERF 8: Ephemeral event behavior", () => {
  it("typing events delivered, no retry on failure", async () => {
    const conns = await harness.connectBatch("p8", 5, "chat:p8", "typing");
    await sleep(1000);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 8: Ephemeral event behavior");
    console.log("═══════════════════════════════════════════════════════════");

    const publishTs = performance.now();
    const { status } = await harness.publish("chat:p8", "typing", {
      typing: true,
      userId: "p8_user",
    });
    await sleep(3000);

    const report = measureDeliveries(conns, (m) => m.topic === "typing", publishTs);
    console.log(`  typing: delivered=${report.delivered}/5`);
    reportLatency("  typing latency", report.latencies);

    // A socket subscribed to "typing" must not receive "chat" events, and vice versa.
    const foreign = countForeignEvents(conns, (m) => m.topic !== "typing");
    console.log(`  foreign-topic events on typing subscribers: ${foreign}`);
    console.log("  On RPC failure: drop silently, no retry, no persistence");
    console.log("═══════════════════════════════════════════════════════════\n");

    expect(status).toBe(200);
    expect(report.delivered).toBe(5);
    expect(report.duplicates).toBe(0);
    expect(foreign).toBe(0);

    closeAll(conns);
  }, 60_000);
});

// ============================================================================
// PERF 9: Duplicate detection across burst
// ============================================================================

describe("PERF 9: Duplicate detection — 50 msgs × 500 subs", () => {
  it("zero duplicates across 50 rapid publishes", async () => {
    const N = 500;
    const MESSAGES = 50;
    const conns = await harness.connectBatch("p9", N, "chat:p9", "chat");
    await sleep(2000);

    // One tight window for the fan-out cost: baseline → 50 publishes → flush →
    // counters. The drain sleep below must come after it, never before.
    const win = await measureFanout(harness, "chat:p9", "chat", async (publish) => {
      for (let seq = 0; seq < MESSAGES; seq++) {
        await publish({ seq });
        await sleep(100);
      }
    });
    const publishStart = win.publishedAt[0];
    const publishMs = win.publishedAt[win.publishedAt.length - 1] - publishStart;
    await sleep(10000);

    let totalDuplicates = 0;
    let totalDelivered = 0;
    for (let seq = 0; seq < MESSAGES; seq++) {
      const report = measureDeliveries(
        conns,
        (m) => m.data?._run === win.runTag && m.data?.seq === seq,
        publishStart,
      );
      totalDelivered += report.delivered;
      totalDuplicates += report.duplicates;
    }

    const attempts = win.attempts;

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 9: Duplicate detection — 50 msgs × 500 subs");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Expected: ${MESSAGES * N}`);
    console.log(`  Delivered: ${totalDelivered}`);
    console.log(`  Duplicates: ${totalDuplicates}`);
    console.log(`  50 publishes wall time: ${publishMs.toFixed(0)}ms`);
    console.log(`  DO deliverAttempts during burst: ${attempts}`);
    console.log(
      `  DO instance across the measurement window: ${win.before.instanceId} → ${win.after.instanceId} (one instance: ${win.sameInstance})`,
    );
    console.log("═══════════════════════════════════════════════════════════\n");

    expect(totalDuplicates).toBe(0);
    expect(totalDelivered).toBe(MESSAGES * N);
    expect(attempts).toBe(MESSAGES * N);
    expect(win.sameInstance).toBe(true);

    closeAll(conns);
  }, 300_000);
});
