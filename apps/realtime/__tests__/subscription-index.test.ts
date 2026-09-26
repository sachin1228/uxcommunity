/**
 * Unit tests for the realtime fan-out data structures.
 *
 * These lock down the properties that made the previous implementation
 * expensive, without needing a Worker or a socket:
 *
 *   1. A broadcast touches only the sockets subscribed to the topic — never
 *      every socket attached to the Durable Object.
 *   2. A duplicate subscribe frame (React remount, reconnect replay) is a
 *      no-op instead of a second subscription.
 *   3. Repeated subscribe/unsubscribe cycles leave no residue, so a long-lived
 *      room cannot accumulate index entries.
 *   4. Closing one tab/device cannot remove a subscription another tab of the
 *      same user still holds.
 *   5. Presence snapshots are built from in-memory state (no attachment
 *      deserialization) and can be skipped when nothing changed.
 */

import { describe, it, expect } from "vitest";
import {
  TopicSocketIndex,
  buildPresenceSnapshot,
  presenceSignature,
  runBoundedPool,
  type PresenceMeta,
} from "../src/subscriptions";

/** Stand-in for a WebSocket: identity is all the index cares about. */
function socket(name: string): { name: string } {
  return { name };
}

describe("TopicSocketIndex — targeted fan-out", () => {
  it("returns only the sockets subscribed to the requested topic", () => {
    const index = new TopicSocketIndex<{ name: string }>();
    const chatA = socket("chatA");
    const chatB = socket("chatB");
    const typing = socket("typing");

    index.add("chat", chatA);
    index.add("chat", chatB);
    index.add("typing", typing);

    const chatRecipients = index.subscribers("chat");
    expect(chatRecipients?.size).toBe(2);
    expect(chatRecipients?.has(chatA)).toBe(true);
    expect(chatRecipients?.has(chatB)).toBe(true);
    // The unrelated socket is not part of the chat fan-out at all.
    expect(chatRecipients?.has(typing)).toBe(false);

    expect([...(index.subscribers("typing") ?? [])]).toEqual([typing]);
    // A topic nobody subscribed to has no recipient set (fast path).
    expect(index.subscribers("reactions")).toBeUndefined();
  });

  it("does not grow on duplicate subscribes", () => {
    const index = new TopicSocketIndex<{ name: string }>();
    const ws = socket("ws");

    expect(index.add("chat", ws)).toBe(true);
    for (let i = 0; i < 50; i += 1) {
      expect(index.add("chat", ws)).toBe(false);
    }

    expect(index.subscriberCount("chat")).toBe(1);
    expect(index.referenceCount).toBe(1);
  });

  it("treats unsubscribe of an unknown subscription as a no-op", () => {
    const index = new TopicSocketIndex<{ name: string }>();
    const ws = socket("ws");

    expect(index.remove("chat", ws)).toBe(false);
    index.add("chat", ws);
    expect(index.remove("typing", ws)).toBe(false);
    expect(index.subscriberCount("chat")).toBe(1);
  });

  it("returns to zero after 100 subscribe/unsubscribe cycles", () => {
    const index = new TopicSocketIndex<{ name: string }>();
    const ws = socket("ws");

    for (let i = 0; i < 100; i += 1) {
      index.add("chat", ws);
      index.add("typing", ws);
      index.remove("chat", ws);
      index.remove("typing", ws);
    }

    expect(index.socketCount).toBe(0);
    expect(index.topicCount).toBe(0);
    expect(index.referenceCount).toBe(0);
    expect(index.socketTopics(ws)).toBeUndefined();
  });

  it("keeps another device's subscription when one socket disconnects", () => {
    const index = new TopicSocketIndex<{ name: string }>();
    const tabA = socket("tabA");
    const tabB = socket("tabB");

    index.add("chat", tabA);
    index.add("chat", tabB);

    const removed = index.removeSocket(tabA);
    expect(removed).toEqual(["chat"]);
    expect([...(index.subscribers("chat") ?? [])]).toEqual([tabB]);

    // Closing the last socket drops the topic entry entirely.
    index.removeSocket(tabB);
    expect(index.subscribers("chat")).toBeUndefined();
    expect(index.topicCount).toBe(0);
  });

  it("evicting a socket removes every topic it held, exactly once", () => {
    const index = new TopicSocketIndex<{ name: string }>();
    const ws = socket("ws");
    index.add("chat", ws);
    index.add("typing", ws);
    index.add("presence", ws);

    expect(index.removeSocket(ws).sort()).toEqual(["chat", "presence", "typing"]);
    expect(index.referenceCount).toBe(0);
    // Idempotent: a close handler racing an eviction cannot double-remove.
    expect(index.removeSocket(ws)).toEqual([]);
    expect(index.referenceCount).toBe(0);
  });

  it("scales the recipient set linearly with subscribers, not with room size", () => {
    // 1,000 sockets attached to a room where only 3 subscribed to the topic:
    // the fan-out must resolve 3 recipients, not walk 1,000 sockets.
    const index = new TopicSocketIndex<{ name: string }>();
    for (let i = 0; i < 997; i += 1) {
      index.add(`other-topic-${i % 5}`, socket(`idle-${i}`));
    }
    const recipients = [socket("r1"), socket("r2"), socket("r3")];
    for (const ws of recipients) index.add("chat", ws);

    const set = index.subscribers("chat");
    expect(set?.size).toBe(3);
    expect([...(set ?? [])]).toEqual(recipients);
    expect(index.socketCount).toBe(1000);
  });
});

describe("buildPresenceSnapshot", () => {
  it("folds multiple sockets per user into one entry with a connection count", () => {
    const userSockets = new Map<string, Set<{ name: string }>>([
      ["u1", new Set([socket("a"), socket("b")])],
      ["u2", new Set([socket("c")])],
    ]);
    const meta = new Map<string, PresenceMeta>([
      ["u1", { name: "Alice", avatar: "a.png" }],
    ]);

    expect(buildPresenceSnapshot(userSockets, meta)).toEqual([
      { id: "u1", name: "Alice", avatar: "a.png", connections: 2 },
      { id: "u2", name: null, avatar: null, connections: 1 },
    ]);
  });

  it("skips users whose last socket just left", () => {
    const userSockets = new Map<string, Set<{ name: string }>>([
      ["u1", new Set()],
      ["u2", new Set([socket("c")])],
    ]);

    expect(buildPresenceSnapshot(userSockets, new Map()).map((u) => u.id)).toEqual(["u2"]);
  });

  it("produces a stable signature until the roster actually changes", () => {
    const snapshot = [
      { id: "u1", name: "Alice", avatar: null, connections: 1 },
      { id: "u2", name: null, avatar: null, connections: 2 },
    ];
    const same = [
      { id: "u1", name: "Alice", avatar: null, connections: 1 },
      { id: "u2", name: null, avatar: null, connections: 2 },
    ];

    expect(presenceSignature(snapshot)).toBe(presenceSignature(same));
    expect(presenceSignature([...snapshot, { id: "u3", name: null, avatar: null, connections: 1 }]))
      .not.toBe(presenceSignature(snapshot));
    expect(
      presenceSignature(snapshot.map((u) => (u.id === "u2" ? { ...u, connections: 1 } : u))),
    ).not.toBe(presenceSignature(snapshot));
  });
});

describe("runBoundedPool", () => {
  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 200 }, (_, i) => i);

    await runBoundedPool(items, 8, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
    });

    expect(peak).toBeLessThanOrEqual(8);
    expect(peak).toBeGreaterThan(1);
  });

  it("processes every item exactly once", async () => {
    const seen = new Map<number, number>();
    const items = Array.from({ length: 1000 }, (_, i) => i);

    await runBoundedPool(items, 13, async (item) => {
      seen.set(item, (seen.get(item) ?? 0) + 1);
    });

    expect(seen.size).toBe(1000);
    expect([...seen.values()].every((count) => count === 1)).toBe(true);
  });

  it("is a no-op for an empty list", async () => {
    let calls = 0;
    await runBoundedPool([], 40, async () => {
      calls += 1;
    });
    expect(calls).toBe(0);
  });

  it("keeps going when one item rejects", async () => {
    const done: number[] = [];
    await expect(
      runBoundedPool([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error("boom");
        done.push(item);
      }),
    ).rejects.toThrow("boom");
    expect(done.sort()).toEqual([1, 3]);
  });
});
