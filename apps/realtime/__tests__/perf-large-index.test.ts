/**
 * PERF 5-6: Large subscriber index (10K and 100K indexed subscriptions).
 * Isolated worker instance.
 *
 * WHAT WAS WRONG
 *   The previous revision opened 10,000 / 100,000 live WebSocket connections in
 *   one miniflare process. Locally that cannot run at all (the runner's heap
 *   tops out well below that — the sibling ws-ownership scale test already
 *   OOMs the runner at 500 sockets), so the tests never delivered anything and
 *   asserted nothing: they "passed" as no-ops.
 *
 * WHAT IT TESTS NOW
 *   CommunityDO stores subscriptions as socket-scoped topic references, so the
 *   index size that matters is `socket ↔ topic` pairs. This revision keeps the
 *   original index sizes (10K / 100K refs) and the original recipient counts
 *   (100 / 500 active chat subscribers) with a bounded live socket population:
 *   each of 500 sockets subscribes to many topics, which is exactly the shape a
 *   member has when they hold chat + typing + presence + threads + … open.
 *
 *   Assertions replace the old log-only reporting:
 *     - delivery lands on exactly the subscribers of the published topic
 *       (never on the other sockets, never on the whole index),
 *     - the DO's `deliverAttempts` grew by exactly that recipient count, which
 *       is the direct evidence that fan-out reads a topic index instead of
 *       scanning the room.
 *
 * Run locally: npx vitest run __tests__/perf-large-index.test.ts --reporter=verbose
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startHarness,
  type Harness,
  type Conn,
  type RoomStats,
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

// ── Shared setup ────────────────────────────────────────────────────────────

/** Live sockets per benchmark — the bounded population miniflare can hold. */
const SOCKETS = 500;
const CHAT_TOPIC = "chat";
const bulkTopic = (j: number) => `bulk_${j}`;

interface IndexedRoom {
  conns: Conn[];
  chatSubscribers: Conn[];
  otherSockets: Conn[];
  setupMs: number;
  stats: RoomStats;
  expectedRefs: number;
}

/**
 * Build a room whose topic index holds `SOCKETS × topicsPerSocket` refs.
 * The first `chatSubscribers` sockets subscribe to `chat` as well as their bulk
 * topics; the rest never touch `chat`, so a publish to it must not reach them.
 */
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
  // Deterministic completion: the DO itself reports how much of the index it holds.
  const stats = await harness.waitForRefs(room, expectedRefs, refTimeoutMs);
  // Let the coalesced presence flush settle so it cannot pollute the metrics delta.
  await sleep(1000);

  return {
    conns,
    chatSubscribers: conns.slice(0, chatSubscribers),
    otherSockets: conns.slice(chatSubscribers),
    setupMs: performance.now() - setupStart,
    stats,
    expectedRefs,
  };
}

// ============================================================================
// PERF 5: Large subscriber index — 10K indexed subscriptions, 100 active
// ============================================================================

describe("PERF 5: Large subscriber index — 10K subscriptions", () => {
  it("10K subscriptions in index, 100 active chat subscribers", async () => {
    const TOTAL_SUBS = 10_000;
    const TOPICS_PER_SOCKET = TOTAL_SUBS / SOCKETS; // 20
    const ACTIVE_CHAT = 100;
    const room = "chat:p5";

    const built = await buildIndexedRoom("p5", room, TOPICS_PER_SOCKET, ACTIVE_CHAT, 120_000);

    // Counter read stays inside the tight window (publish → flush → counters),
    // ahead of the drain sleep that follows it.
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
    console.log(`  Total subscriptions in index: ${built.stats.subscriptionRefs}/${TOTAL_SUBS}`);
    console.log(`  Indexed topics: ${built.stats.topics}`);
    console.log(`  Setup (connect + subscribe): ${built.setupMs.toFixed(0)}ms`);
    console.log(`  Active chat subscribers: ${ACTIVE_CHAT}`);
    console.log(`  HTTP /publish status: ${status}  response: ${httpLatency.toFixed(1)}ms`);
    console.log(`  Delivered: ${report.delivered}/${ACTIVE_CHAT}  (duplicates: ${report.duplicates})`);
    console.log(`  Leaked to non-subscribers: ${leaked}`);
    console.log(`  DO deliverAttempts for this publish: ${attempts}`);
    console.log(
      `  DO instance across the measurement window: ${win.before.instanceId} → ${win.after.instanceId} (one instance: ${win.sameInstance})`,
    );
    console.log(`  Subscriber lookup: O(1) via subscriptionsByTopic.get("chat")`);
    console.log(`  Broadcast: O(${ACTIVE_CHAT}) — only active subscribers`);
    reportLatency("End-to-end delivery", report.latencies);
    console.log("═══════════════════════════════════════════════════════════\n");

    expect(status).toBe(200);
    expect(built.stats.subscriptionRefs).toBe(TOTAL_SUBS);
    expect(built.stats.sockets).toBe(SOCKETS);
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
    const TOPICS_PER_SOCKET = TOTAL_SUBS / SOCKETS; // 200
    const ACTIVE_CHAT = SOCKETS; // every socket subscribes to chat at this scale
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
    console.log(`  Total subscriptions in index: ${built.stats.subscriptionRefs}/${TOTAL_SUBS}`);
    console.log(`  Indexed topics: ${built.stats.topics}`);
    console.log(`  Setup (connect + subscribe): ${built.setupMs.toFixed(0)}ms`);
    console.log(`  Active chat subscribers: ${ACTIVE_CHAT}`);
    console.log(`  HTTP /publish status: ${status}  response: ${httpLatency.toFixed(1)}ms`);
    console.log(`  Delivered: ${report.delivered}/${ACTIVE_CHAT}  (duplicates: ${report.duplicates})`);
    console.log(`  DO deliverAttempts for this publish: ${attempts}`);
    console.log(
      `  DO instance across the measurement window: ${win.before.instanceId} → ${win.after.instanceId} (one instance: ${win.sameInstance})`,
    );
    console.log(`  Subscriber lookup: O(1)`);
    console.log(`  Broadcast: O(${report.delivered}) — only active subscribers`);
    reportLatency("End-to-end delivery", report.latencies);
    console.log("═══════════════════════════════════════════════════════════\n");

    expect(status).toBe(200);
    expect(built.stats.subscriptionRefs).toBe(TOTAL_SUBS);
    expect(built.stats.sockets).toBe(SOCKETS);
    expect(report.delivered).toBe(ACTIVE_CHAT);
    expect(report.duplicates).toBe(0);
    expect(attempts).toBe(ACTIVE_CHAT);
    expect(win.sameInstance).toBe(true);

    closeAll(built.conns);
  }, 900_000);
});
