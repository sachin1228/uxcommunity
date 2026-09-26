/**
 * PERF 9: Duplicate detection — measures zero duplicates across rapid publishes.
 *
 * Instead of 500 sequential WS opens (which times out in miniflare),
 * this test uses a smaller set of concurrent connections and verifies
 * that rapid publishes produce exactly 1 delivery per subscriber per message.
 *
 * Room ownership: subscribers connect to the COMMUNITY room they are measured
 * on (`chat:p9`), matching production (apps/web/lib/realtime/client.ts opens one
 * socket per community room). The previous revision connected them to
 * `user:${id}`, a different Durable Object that a `chat:*` publish never
 * reaches — this suite failed with `expected +0 to be 2500` before the fix,
 * which is exactly the silent-zero evidence the harness now makes impossible.
 *
 * Run: npx vitest run __tests__/perf-duplicates.test.ts --reporter=verbose
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startHarness,
  type Harness,
  sleep,
  measureDeliveries,
  countForeignEvents,
  measureFanout,
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
// PERF 9: Duplicate detection — 50 msgs × 50 subscribers
// ============================================================================

describe("PERF 9: Duplicate detection — 50 msgs × 50 subs", () => {
  it("zero duplicates across 50 rapid publishes", async () => {
    const N = 50;
    const MESSAGES = 50;
    const conns = await harness.connectBatch("p9", N, "chat:p9", "chat");
    await sleep(2000);

    // Publish the burst and read the DO's fan-out cost in ONE tight window
    // (baseline → publish → flush → counters). Reading the counters after the
    // drain sleep below is a different measurement: the counters belong to a DO
    // instance, and a replacement answers with a delta of 0 for a burst that
    // really was fanned out.
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

    // A socket that never asked for this topic must never see the event, and the
    // DO must have attempted exactly one send per subscriber per message — no
    // scan of the room, no duplicate send.
    const foreign = countForeignEvents(
      conns,
      (m) => m.topic !== "chat" && m.data?._run === win.runTag,
    );
    const attempts = win.attempts;

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 9: Duplicate detection — 50 msgs × 50 subs");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Expected: ${MESSAGES * N}`);
    console.log(`  Delivered: ${totalDelivered}`);
    console.log(`  Duplicates: ${totalDuplicates}`);
    console.log(`  Foreign-topic events: ${foreign}`);
    console.log(`  50 publishes wall time: ${publishMs.toFixed(0)}ms`);
    console.log(`  DO deliverAttempts during burst: ${attempts}`);
    console.log(
      `  DO instance across the measurement window: ${win.before.instanceId} → ${win.after.instanceId} (one instance: ${win.sameInstance})`,
    );
    console.log(
      `  Indexed subscriptions: ${win.after.subscriptionRefs} over ${win.after.topics} topic(s)`,
    );
    console.log("═══════════════════════════════════════════════════════════\n");

    expect(totalDuplicates).toBe(0);
    expect(totalDelivered).toBe(MESSAGES * N);
    expect(foreign).toBe(0);
    // 50 messages × 50 subscribers — no send was wasted on a non-subscriber.
    expect(attempts).toBe(MESSAGES * N);
    // Guards the measurement itself: a counter delta only means anything when
    // one DO instance served the whole window.
    expect(win.sameInstance).toBe(true);
    expect(win.after.subscriptionRefs).toBe(N);

    closeAll(conns);
  }, 180_000);
});
