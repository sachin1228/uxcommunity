/**
 * Comprehensive performance and validation benchmarks.
 *
 * Covers:
 *   1. Corrected latency measurement (actual client receive time)
 *   2. Burst traffic (10 and 100 messages × 500 subscribers)
 *   3. Multiple hot communities (3 × 500)
 *   4. Large subscriber index (10K and 100K indexed subscriptions)
 *   5. Durable event recovery
 *   6. Ephemeral event behavior (no retry)
 *   7. Duplicate detection across burst
 *
 * Room ownership (the bug this suite used to hide)
 *   Subscribers connect to the COMMUNITY room under test (`chat:*`), exactly as
 *   production does — apps/web/lib/realtime/client.ts opens one socket per
 *   community room and subscribes its topics there. The previous revision
 *   connected every synthetic subscriber to `user:${id}`, a different Durable
 *   Object than the one a `chat:*` publish targets, so every scenario below ran
 *   against an empty room: 0 deliveries, nothing asserted, suite "green".
 *   See ./helpers/realtime-harness.ts for the invariant and the counters used
 *   to prove deliveries are real and targeted.
 *
 * Index size vs live sockets
 *   CommunityDO stores subscriptions as socket-scoped topic references. The
 *   original PERF 5/6 opened 10K/100K live sockets, which cannot run in one
 *   miniflare process (the runner's heap gives out long before that), so those
 *   scenarios measured nothing. This revision keeps the original index sizes
 *   (10K/100K refs) by giving 500 live sockets the many topic subscriptions a
 *   real member holds, and asserts delivery lands on the published topic's
 *   subscribers only.
 *
 * Run: npx vitest run __tests__/performance.integration.test.ts --reporter=verbose
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

// ── Shared index-building helper (PERF 5-6) ─────────────────────────────────

/** Live sockets per index benchmark — the bounded population miniflare can hold. */
const SOCKETS = 500;
const CHAT_TOPIC = "chat";
const bulkTopic = (j: number) => `bulk_${j}`;

interface IndexedRoom {
  conns: Conn[];
  chatSubscribers: Conn[];
  otherSockets: Conn[];
  setupMs: number;
  indexRefs: number;
  indexedTopics: number;
}

async function buildIndexedRoom(
  prefix: string,
  room: string,
  topicsPerSocket: number,
  chatSubscribers: number,
  refTimeoutMs: number,
): Promise<IndexedRoom> {
  const setupStart = performance.now();
  const conns: Conn[] = [];

  for (let i = 0; i < SOCKETS; i++) {
    const conn = await harness.connect(room, `${prefix}_${i}`);
    const isChatSubscriber = i < chatSubscribers;
    if (isChatSubscriber) harness.subscribe(conn, room, CHAT_TOPIC);
    const bulkCount = topicsPerSocket - (isChatSubscriber ? 1 : 0);
    for (let j = 0; j < bulkCount; j++) harness.subscribe(conn, room, bulkTopic(j));
    conns.push(conn);
  }

  const expectedRefs = SOCKETS * topicsPerSocket;
  const ready = await harness.waitForRefs(room, expectedRefs, refTimeoutMs);
  await sleep(1000); // let the coalesced presence flush settle before measuring

  return {
    conns,
    chatSubscribers: conns.slice(0, chatSubscribers),
    otherSockets: conns.slice(chatSubscribers),
    setupMs: performance.now() - setupStart,
    indexRefs: ready.subscriptionRefs,
    indexedTopics: ready.topics ?? 0,
  };
}

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

    const report = measureDeliveries(conns, (m) => m.data?.seq === 1, publishTs);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 1: 500 subscribers — corrected latency");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Connect + subscribe setup: ${connectMs.toFixed(0)}ms`);
    console.log(`  HTTP status: ${status}`);
    console.log(`  HTTP /publish response time: ${httpLatency.toFixed(1)}ms`);
    console.log(`  Delivered: ${report.delivered}/${N}`);
    console.log(`  Failed deliveries: ${N - report.delivered}`);
    reportLatency("End-to-end (T0=publish, T1=client receive)", report.latencies);
    console.log("═══════════════════════════════════════════════════════════\n");

    expect(status).toBe(200);
    expect(report.delivered).toBe(N);
    expect(report.duplicates).toBe(0);

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
    const conns = await harness.connectBatch("p2", N, "chat:p2", "chat");
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
    const conns = await harness.connectBatch("p3", N, "chat:p3", "chat");
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

// ============================================================================
// PERF 4: Multiple hot communities — 3 × 500
// ============================================================================

describe("PERF 4: Multiple hot communities — 3 × 500", () => {
  it("concurrent publishes to 3 communities, no cross-leakage", async () => {
    const N = 500;
    const comms = ["chat:p4_A", "chat:p4_B", "chat:p4_C"];
    const connsPerComm: Conn[][] = [];

    for (const comm of comms) {
      connsPerComm.push(await harness.connectBatch(`p4_${comm}`, N, comm, "chat"));
    }
    await sleep(2000);

    const publishTs = performance.now();
    await Promise.all(comms.map((comm) => harness.publish(comm, "chat", { from: comm })));
    await sleep(5000);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 4: Multiple hot communities — 3 × 500");
    console.log("═══════════════════════════════════════════════════════════");

    let totalDelivered = 0;
    let totalLeaked = 0;
    for (let ci = 0; ci < comms.length; ci++) {
      const comm = comms[ci];
      const conns = connsPerComm[ci];
      const report = measureDeliveries(conns, (m) => m.data?.from === comm, publishTs);
      const leaked = countForeignEvents(
        conns,
        (m) => typeof m.data?.from === "string" && m.data.from !== comm,
      );
      totalDelivered += report.delivered;
      totalLeaked += leaked;

      console.log(
        `  ${comm}: delivered=${report.delivered}/${N}  duplicated=${report.duplicates}  leaked=${leaked}`,
      );
      reportLatency(`  ${comm} latency`, report.latencies);
    }
    console.log("═══════════════════════════════════════════════════════════\n");

    expect(totalDelivered).toBe(N * comms.length);
    expect(totalLeaked).toBe(0);

    for (const conns of connsPerComm) closeAll(conns);
  }, 600_000);
});

// ============================================================================
// PERF 5: Large subscriber index — 10K indexed subscriptions, 100 active
// ============================================================================

describe("PERF 5: Large subscriber index — 10K subscriptions", () => {
  it("10K subscriptions in index, 100 active chat subscribers", async () => {
    const TOTAL_SUBS = 10_000;
    const TOPICS_PER_SOCKET = TOTAL_SUBS / SOCKETS;
    const ACTIVE_CHAT = 100;
    const room = "chat:p5";

    const built = await buildIndexedRoom("p5", room, TOPICS_PER_SOCKET, ACTIVE_CHAT, 120_000);

    // The counters are read inside the publish window — before the drain sleep
    // below. They belong to one DO instance, so a read taken after a long idle
    // gap can be answered by a replacement that reports a delta of 0 for a
    // fan-out it never performed.
    let status = 0;
    let httpLatency = 0;
    const win = await measureFanout(harness, room, CHAT_TOPIC, async (publish) => {
      const res = await publish({ seq: 1 });
      status = res.status;
      httpLatency = res.ms;
    });
    const attempts = win.attempts;
    const publishTs = win.publishedAt[0];
    await sleep(5000);

    const report = measureDeliveries(
      built.chatSubscribers,
      (m) => m.data?._run === win.runTag && m.data?.seq === 1,
      publishTs,
    );
    const leaked = countForeignEvents(built.otherSockets, (m) => m.data?._run === win.runTag);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 5: Large subscriber index — 10K subscriptions");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Live sockets: ${SOCKETS}   Topics per socket: ${TOPICS_PER_SOCKET}`);
    console.log(`  Total subscriptions in index: ${built.indexRefs}/${TOTAL_SUBS}`);
    console.log(`  Indexed topics: ${built.indexedTopics}`);
    console.log(`  Setup (connect + subscribe): ${built.setupMs.toFixed(0)}ms`);
    console.log(`  Active chat subscribers: ${ACTIVE_CHAT}`);
    console.log(`  HTTP /publish status: ${status}  response: ${httpLatency.toFixed(1)}ms`);
    console.log(`  Delivered: ${report.delivered}/${ACTIVE_CHAT}  duplicates: ${report.duplicates}`);
    console.log(`  Leaked to non-subscribers: ${leaked}`);
    console.log(`  DO deliverAttempts for this publish: ${attempts}`);
    console.log(
      `  DO instance across the measurement window: ${win.before.instanceId} → ${win.after.instanceId} (one instance: ${win.sameInstance})`,
    );
    console.log(`  Subscriber lookup: O(1)   Broadcast: O(${ACTIVE_CHAT})`);
    reportLatency("End-to-end delivery", report.latencies);
    console.log("═══════════════════════════════════════════════════════════\n");

    expect(status).toBe(200);
    expect(built.indexRefs).toBe(TOTAL_SUBS);
    expect(report.delivered).toBe(ACTIVE_CHAT);
    expect(report.duplicates).toBe(0);
    expect(leaked).toBe(0);
    expect(attempts).toBe(ACTIVE_CHAT);
    expect(win.sameInstance).toBe(true);

    closeAll(built.conns);
  }, 600_000);
});

// ============================================================================
// PERF 6: Large subscriber index — 100K indexed subscriptions, 500 active
// ============================================================================

describe("PERF 6: Large subscriber index — 100K subscriptions", () => {
  it("100K subscriptions in index, 500 active chat subscribers", async () => {
    const TOTAL_SUBS = 100_000;
    const TOPICS_PER_SOCKET = TOTAL_SUBS / SOCKETS;
    const ACTIVE_CHAT = SOCKETS;
    const room = "chat:p6";

    const built = await buildIndexedRoom("p6", room, TOPICS_PER_SOCKET, ACTIVE_CHAT, 300_000);

    let status = 0;
    let httpLatency = 0;
    const win = await measureFanout(harness, room, CHAT_TOPIC, async (publish) => {
      const res = await publish({ seq: 1 });
      status = res.status;
      httpLatency = res.ms;
    });
    const attempts = win.attempts;
    const publishTs = win.publishedAt[0];
    await sleep(10000);

    const report = measureDeliveries(
      built.chatSubscribers,
      (m) => m.data?._run === win.runTag && m.data?.seq === 1,
      publishTs,
    );

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 6: Large subscriber index — 100K subscriptions");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Live sockets: ${SOCKETS}   Topics per socket: ${TOPICS_PER_SOCKET}`);
    console.log(`  Total subscriptions in index: ${built.indexRefs}/${TOTAL_SUBS}`);
    console.log(`  Indexed topics: ${built.indexedTopics}`);
    console.log(`  Setup (connect + subscribe): ${built.setupMs.toFixed(0)}ms`);
    console.log(`  Active chat subscribers: ${ACTIVE_CHAT}`);
    console.log(`  HTTP /publish status: ${status}  response: ${httpLatency.toFixed(1)}ms`);
    console.log(`  Delivered: ${report.delivered}/${ACTIVE_CHAT}  duplicates: ${report.duplicates}`);
    console.log(`  DO deliverAttempts for this publish: ${attempts}`);
    console.log(
      `  DO instance across the measurement window: ${win.before.instanceId} → ${win.after.instanceId} (one instance: ${win.sameInstance})`,
    );
    console.log(`  Subscriber lookup: O(1)   Broadcast: O(${report.delivered})`);
    reportLatency("End-to-end delivery", report.latencies);
    console.log("═══════════════════════════════════════════════════════════\n");

    expect(status).toBe(200);
    expect(built.indexRefs).toBe(TOTAL_SUBS);
    expect(report.delivered).toBe(ACTIVE_CHAT);
    expect(report.duplicates).toBe(0);
    expect(attempts).toBe(ACTIVE_CHAT);
    expect(win.sameInstance).toBe(true);

    closeAll(built.conns);
  }, 900_000);
});

// ============================================================================
// PERF 7: Durable event recovery — chat/edit/delete/reaction
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
    await harness.publish("chat:p8", "typing", { typing: true, userId: "p8_user" });
    await sleep(3000);

    const report = measureDeliveries(conns, (m) => m.topic === "typing", publishTs);
    const foreign = countForeignEvents(conns, (m) => m.topic !== "typing");
    console.log(`  typing: delivered=${report.delivered}/5  foreign-topic: ${foreign}`);
    reportLatency("  typing latency", report.latencies);
    console.log("  On RPC failure: drop silently, no retry, no persistence");
    console.log("═══════════════════════════════════════════════════════════\n");

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

    let totalDuplicates = 0;
    let totalDelivered = 0;

    // One tight window for the fan-out cost, then the drain sleep.
    const win = await measureFanout(harness, "chat:p9", "chat", async (publish) => {
      for (let seq = 0; seq < MESSAGES; seq++) {
        await publish({ seq });
        await sleep(100);
      }
    });
    const attempts = win.attempts;
    const publishStart = win.publishedAt[0];
    await sleep(10000);

    for (let seq = 0; seq < MESSAGES; seq++) {
      const report = measureDeliveries(
        conns,
        (m) => m.data?._run === win.runTag && m.data?.seq === seq,
        publishStart,
      );
      totalDelivered += report.delivered;
      totalDuplicates += report.duplicates;
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  PERF 9: Duplicate detection — 50 msgs × 500 subs");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Expected: ${MESSAGES * N}`);
    console.log(`  Delivered: ${totalDelivered}`);
    console.log(`  Duplicates: ${totalDuplicates}`);
    console.log(`  DO deliverAttempts during burst: ${attempts}`);
    console.log(
      `  DO instance across the measurement window: ${win.before.instanceId} → ${win.after.instanceId} (one instance: ${win.sameInstance})`,
    );
    console.log("═══════════════════════════════════════════════════════════\n");

    expect(totalDelivered).toBe(MESSAGES * N);
    expect(totalDuplicates).toBe(0);
    expect(attempts).toBe(MESSAGES * N);
    expect(win.sameInstance).toBe(true);

    closeAll(conns);
  }, 300_000);
});
