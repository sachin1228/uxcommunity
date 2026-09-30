/**
 * Presence scaling — the H-3 finding, pinned.
 *
 * The staging ladder (docs/realtime-5k-loadtest-audit.md) showed a Community
 * Room collapsing at 2,500 sockets while its message fan-out stayed healthy:
 * presence was serialized as one roster entry per member (id, name, avatar,
 * connection count) and written to EVERY attached socket on every coalesced
 * change. Bytes and sends therefore grew with members × sockets — a 1,500-socket
 * suite had to stub the frames out to avoid OOM before it could measure
 * anything.
 *
 * The payload is now the online-member count. These tests pin the four
 * properties that make that a fix and not a regression:
 *
 *   1. BOUNDED WORK — the presence frame does not grow with the room, and one
 *      flush window never writes to more than the per-window send budget, so a
 *      5,000-socket room cannot pin the DO inside a single timer callback.
 *   2. CORRECT COUNTING — a member with several tabs/devices counts once, and
 *      disappears only when their LAST socket closes.
 *   3. ISOLATION — presence never appears on a message topic, and a publish's
 *      byte cost stays what its recipients paid for.
 *   4. NO NEW CLIENT-PUBLISH PATH — the count is server-authored; a socket that
 *      publishes `presence` frames cannot move it (PR #542 allow-list).
 *
 * Connection counts stay modest on purpose: the test runner, not the Worker, is
 * the bottleneck above a few hundred sockets (see targeted-fanout.test.ts).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startHarness,
  closeAll,
  sleep,
  type Conn,
  type Harness,
  type RoomStats,
} from "./helpers/realtime-harness";

let harness: Harness;

beforeAll(async () => {
  harness = await startHarness();
}, 30_000);

afterAll(async () => {
  await harness?.stop();
});

/** Every presence frame a socket received, oldest first. */
function presenceFrames(conn: Conn): Array<Record<string, any>> {
  return conn.messages.filter((m) => m.t === "presence");
}

/** The most recent online-member count this socket was told about. */
function lastPresence(conn: Conn): Record<string, any> | undefined {
  return presenceFrames(conn).at(-1);
}

async function waitUntil(label: string, predicate: () => boolean, ms = 10_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (predicate()) return;
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}`);
    await sleep(100);
  }
}

async function waitForPresenceCount(conn: Conn, count: number): Promise<void> {
  await waitUntil(`presence count ${count}`, () => lastPresence(conn)?.count === count);
}

async function waitForStats(
  room: string,
  predicate: (stats: RoomStats) => boolean,
  ms = 10_000,
): Promise<RoomStats> {
  const start = Date.now();
  let last: RoomStats | null = null;
  for (;;) {
    last = await harness.stats(room);
    if (predicate(last)) return last;
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for stats: ${JSON.stringify(last)}`);
    await sleep(100);
  }
}

/**
 * Publish one event and read the DO counters that bracket it.
 *
 * Same instance-guard as the perf harness: a hibernating/rebuilt Durable Object
 * restarts its counters, so a delta measured across a replacement is garbage.
 * Re-measure instead of asserting on it, and fail loudly if it never settles.
 */
async function measurePublish(
  room: string,
  topic: string,
  data: unknown,
): Promise<{ recipients: number; bytes: number }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = await harness.stats(room);
    const { status } = await harness.publish(room, topic, data);
    expect(status).toBe(200);
    await sleep(400);
    const after = await harness.stats(room);
    const sameInstance = !before.instanceId || !after.instanceId || before.instanceId === after.instanceId;
    if (!sameInstance) continue;
    return {
      recipients: after.metrics.fanoutRecipients - before.metrics.fanoutRecipients,
      bytes: after.metrics.eventPayloadBytes - before.metrics.eventPayloadBytes,
    };
  }
  throw new Error("DO instance was replaced during every publish measurement");
}

describe("presence payload is bounded by the room, not by the members in it", () => {
  it("sends the same frame size to a 63-socket room as to a 3-socket room", async () => {
    const room = "chat:presence-payload";
    const small = await harness.connectBatch("pp_small", 3, room, "message", { expectRefs: 3 });
    try {
      await waitForPresenceCount(small[0]!, 3);
      const smallFrame = JSON.stringify(lastPresence(small[0]!)).length;

      // 60 more members join. A per-member roster would multiply this frame by
      // ~20×; a count adds one digit.
      const large = await harness.connectBatch("pp_large", 60, room, "message", { expectRefs: 63 });
      try {
        await waitForPresenceCount(small[0]!, 63);
        const largeFrame = JSON.stringify(lastPresence(small[0]!)).length;
        const frame = lastPresence(small[0]!)!;

        expect(frame.count).toBe(63);
        expect(largeFrame - smallFrame).toBeLessThanOrEqual(4);
        expect(largeFrame).toBeLessThan(120);
        // Nothing per-member is ever serialized.
        expect(frame.users).toBeUndefined();
        expect(frame.topic).toBeUndefined();
        // And the room's own view agrees: 63 sockets, 63 members.
        const stats = await waitForStats(room, (s) => s.sockets === 63);
        expect(stats.users).toBe(63);
        expect(stats.metrics.presenceDeliverAttempts).toBeGreaterThan(0);
      } finally {
        closeAll(large);
      }
    } finally {
      closeAll(small);
    }
  }, 60_000);

  it("keeps presence bytes per recipient constant while the room grows", async () => {
    const room = "chat:presence-bytes";
    const conns = await harness.connectBatch("pb", 40, room, "message", { expectRefs: 40 });
    // Churn the room so several flushes are counted, then read the DO's totals.
    const churn = await harness.connectBatch("pb_churn", 20, room, "message", { expectRefs: 60 });
    try {
      await waitForStats(room, (s) => s.sockets === 60);
      await sleep(600);
      const stats = await harness.stats(room);
      const { presenceBroadcasts, presenceDeliverAttempts, presencePayloadBytes } = stats.metrics;

      expect(presenceBroadcasts).toBeGreaterThan(0);
      expect(presenceDeliverAttempts).toBeGreaterThan(0);
      expect(presencePayloadBytes).toBeGreaterThan(0);

      // The whole point: every presence send carried one small count frame, so
      // per-recipient bytes are a constant rather than a function of the 60
      // members in the room (the roster version sat at ~70-100 B per MEMBER).
      expect(presencePayloadBytes / presenceDeliverAttempts).toBeLessThanOrEqual(128);

      // A broadcast cannot address more sockets than the room ever had.
      expect(presenceDeliverAttempts).toBeLessThanOrEqual(presenceBroadcasts * stats.sockets + stats.sockets);
      // 60 sockets fit in one window, so normal-sized communities still get every
      // change in a single flush — no rotation, no delay.
      expect(stats.metrics.presenceDeferredWindows).toBe(0);
    } finally {
      closeAll(churn);
      closeAll(conns);
    }
  }, 60_000);

  it("rotates a room larger than the send budget without ever overrunning one window", async () => {
    const room = "chat:presence-budget";
    // 300 sockets against a 256-send window: the room cannot be refreshed in a
    // single flush, which is exactly what pinned the DO at 4,351 sockets.
    const conns = await harness.connectBatch("budget", 300, room, "message", {
      expectRefs: 300,
      refTimeoutMs: 90_000,
    });
    try {
      // The tail of the room must still learn the count, not just the sockets
      // that happened to be first in the rotation.
      const observer = conns.at(-1)!;
      await waitForPresenceCount(observer, 300);

      const stats = await harness.stats(room);
      expect(stats.sockets).toBe(300);
      expect(stats.metrics.presenceBroadcasts).toBeGreaterThan(0);
      // Hard bound on work per window: sends ≤ windows × budget.
      expect(stats.metrics.presenceDeliverAttempts).toBeLessThanOrEqual(
        stats.metrics.presenceBroadcasts * 256,
      );
      expect(stats.metrics.presenceDeferredWindows).toBeGreaterThan(0);

      // A change keeps converging: closing one member reaches the whole room.
      conns[0]!.close();
      await waitForPresenceCount(observer, 299);
    } finally {
      closeAll(conns);
    }
  }, 180_000);

  it("skips the broadcast entirely while the count is unchanged", async () => {
    const room = "chat:presence-idle";
    const conns = await harness.connectBatch("pi", 5, room, "message", { expectRefs: 5 });
    try {
      await waitForPresenceCount(conns[0]!, 5);
      // Let every connect-triggered flush drain, then measure an idle window.
      await sleep(500);
      const before = await harness.stats(room);
      await sleep(1000);
      const after = await harness.stats(room);

      if (before.instanceId && after.instanceId && before.instanceId === after.instanceId) {
        expect(after.metrics.presenceBroadcasts).toBe(before.metrics.presenceBroadcasts);
        expect(after.metrics.presencePayloadBytes).toBe(before.metrics.presencePayloadBytes);
      }
    } finally {
      closeAll(conns);
    }
  }, 30_000);
});

describe("presence counts members, not sockets", () => {
  it("keeps a member online until their last tab closes", async () => {
    const room = "chat:presence-multidevice";
    const aliceOne = await harness.connect(room, "md_alice");
    const aliceTwo = await harness.connect(room, "md_alice");
    const bob = await harness.connect(room, "md_bob");
    for (const conn of [aliceOne, aliceTwo, bob]) harness.subscribe(conn, room, "message");

    try {
      const stats = await waitForStats(room, (s) => s.sockets === 3 && s.subscriptionRefs === 3);
      expect(stats.users).toBe(2);
      await waitForPresenceCount(bob, 2);

      // One of Alice's two tabs closes — she is still online.
      aliceOne.close();
      await waitForStats(room, (s) => s.sockets === 2);
      await sleep(400);
      expect(lastPresence(bob)?.count).toBe(2);

      // Her last tab closes — now she is gone.
      aliceTwo.close();
      const afterLeave = await waitForStats(room, (s) => s.sockets === 1 && s.users === 1);
      expect(afterLeave.users).toBe(1);
      await waitForPresenceCount(bob, 1);
    } finally {
      closeAll([aliceOne, aliceTwo, bob]);
    }
  }, 30_000);

  it("forgets the settled count when the room empties, so the next member is told", async () => {
    const room = "chat:presence-reset";
    const first = await harness.connect(room, "pr_first");
    harness.subscribe(first, room, "message");
    await waitForPresenceCount(first, 1);

    first.close();
    await waitForStats(room, (s) => s.sockets === 0);
    await sleep(400);

    const next = await harness.connect(room, "pr_next");
    harness.subscribe(next, room, "message");
    try {
      await waitUntil(
        "the next member is told count 1",
        () => lastPresence(next)?.count === 1,
      );
    } finally {
      closeAll([next]);
    }
  }, 30_000);

  it("returns to zero when the room empties", async () => {
    const room = "chat:presence-empty";
    const conn = await harness.connect(room, "pe_solo");
    harness.subscribe(conn, room, "message");
    await waitForPresenceCount(conn, 1);

    conn.close();
    const stats = await waitForStats(room, (s) => s.sockets === 0);
    expect(stats.users).toBe(0);
  }, 30_000);
});

describe("a socket that arrives while the count is unchanged is still told the count", () => {
  /**
   * The production failure this pins: presence is pushed only when it changes,
   * and a settled count is reused while the sockets it was proven on are the
   * same ones. A tab that reloads (or a second device that connects) does not
   * move the member count, so the socket that arrived was never told anything
   * and rendered "0 online" until some other member joined or left — while
   * another tab of the same account, which had been told, still showed 1.
   */
  it("tells a member's second socket, though their own count did not move", async () => {
    const room = "chat:presence-second-socket";
    const alice = await harness.connect(room, "ss_alice");
    harness.subscribe(alice, room, "message");
    try {
      await waitForPresenceCount(alice, 1);
      // Let the connect-triggered flush settle so the count is "proven" on
      // every socket before the second one arrives.
      await sleep(500);

      const aliceSecond = await harness.connect(room, "ss_alice");
      harness.subscribe(aliceSecond, room, "message");
      try {
        const stats = await waitForStats(room, (s) => s.sockets === 2);
        // One member, two sockets: the count has not moved…
        expect(stats.users).toBe(1);
        // …and the socket that arrived must be told anyway.
        await waitUntil(
          "the second socket is told count 1",
          () => lastPresence(aliceSecond)?.count === 1,
        );
      } finally {
        closeAll([aliceSecond]);
      }
    } finally {
      closeAll([alice]);
    }
  }, 30_000);

  it("tells a reloaded tab's replacement socket while another member keeps the room online", async () => {
    const room = "chat:presence-replacement";
    const bob = await harness.connect(room, "rp_bob");
    harness.subscribe(bob, room, "message");
    const alice = await harness.connect(room, "rp_alice");
    harness.subscribe(alice, room, "message");
    try {
      await waitForPresenceCount(bob, 2);
      await sleep(500);

      // Alice reloads: her socket goes and its replacement takes over inside the
      // same coalescing window, so the room never drops below two members and
      // the count reads 2 before the flush and after it.
      alice.close();
      const aliceReloaded = await harness.connect(room, "rp_alice");
      harness.subscribe(aliceReloaded, room, "message");
      try {
        await waitUntil(
          "the replacement socket is told count 2",
          () => lastPresence(aliceReloaded)?.count === 2,
        );
        expect(lastPresence(bob)?.count).toBe(2);
      } finally {
        closeAll([aliceReloaded]);
      }
    } finally {
      closeAll([alice, bob]);
    }
  }, 30_000);
});

describe("presence stays out of the message path", () => {
  it("never delivers on a message topic and costs one small frame per publish", async () => {
    const room = "chat:presence-isolation";
    const conns = await harness.connectBatch("iso", 10, room, "message", { expectRefs: 10 });
    try {
      await waitForPresenceCount(conns[0]!, 10);

      const measured = await measurePublish(room, "message", { seq: 1 });
      expect(measured.recipients).toBe(10);
      expect(measured.bytes / measured.recipients).toBeLessThan(256);

      for (const conn of conns) {
        // Exactly one copy of the event, delivered as an event…
        const events = conn.messages.filter((m) => m.t === "event" && m.data?.seq === 1);
        expect(events.length).toBe(1);
        // …and presence frames are not routable as events: no topic, no data.
        for (const frame of presenceFrames(conn)) {
          expect(frame.topic).toBeUndefined();
          expect(frame.data).toBeUndefined();
        }
      }
    } finally {
      closeAll(conns);
    }
  }, 30_000);

  it("cannot be moved by a client publish frame (PR #542 allow-list)", async () => {
    const room = "chat:presence-security";
    const conns = await harness.connectBatch("sec", 4, room, "message", { expectRefs: 4 });
    try {
      const observer = conns[0]!;
      const attacker = conns[1]!;
      await waitForPresenceCount(observer, 4);

      // A client may only publish `typing`; presence is server-authored. Both a
      // direct presence publish and a forged count on another topic are refused.
      attacker.ws.send(JSON.stringify({ t: "publish", room, topic: "presence", data: { count: 9999 } }));
      attacker.ws.send(JSON.stringify({ t: "publish", room, topic: "message", data: { t: "presence", count: 9999 } }));
      await sleep(600);

      expect(lastPresence(observer)?.count).toBe(4);
      expect(observer.messages.filter((m) => m.t === "event").length).toBe(0);

      const stats = await harness.stats(room);
      expect(stats.metrics.clientPublishRejectedTopic).toBeGreaterThanOrEqual(1);
      expect(stats.metrics.clientPublishesAccepted).toBe(0);
    } finally {
      closeAll(conns);
    }
  }, 30_000);
});
