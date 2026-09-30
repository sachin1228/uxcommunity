/**
 * Unit tests for the presence broadcast rule — no Worker, no sockets, fake timers.
 *
 * WHY THIS EXISTS
 *   Presence is a push: the room only tells its sockets the online-member count
 *   when something changes, and it deliberately reuses a count it has already
 *   proven sits on every attached socket (`presenceSkipped`) instead of
 *   re-broadcasting an unchanged number forever. That shortcut is correct only
 *   while the SOCKETS are the same ones the count was proven on.
 *
 *   The online-member count does not move when one socket replaces another — a
 *   tab reload, a heartbeat reconnect, a second device, or one member leaving
 *   exactly as another joins. The socket that arrived has never been told
 *   anything, so a skip decided from the count alone leaves it rendering
 *   "0 online" until some other member joins or leaves. That is the production
 *   bug these tests pin (a reloaded tab stayed at 0 while another tab of the
 *   same account showed 1), and it is exactly the case a room-wide integration
 *   test cannot drive deterministically: the replacement has to land inside one
 *   150 ms coalescing window.
 *
 * WHAT IS PINNED
 *   1. A second socket of an already-online member is told the count, even
 *      though the member count did not move.
 *   2. A socket that replaces another member's socket inside one window is told
 *      the count, even though the count is unchanged and the population is the
 *      same size.
 *   3. The optimization survives: a mark with no count change AND no socket
 *      change still skips (no frame, `presenceSkipped` moves) — a room that is
 *      genuinely quiet must not re-broadcast on every join-metadata frame.
 *   4. An emptied room forgets the settled count, so the next member to arrive is
 *      told it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PresenceBroadcaster } from "../src/presence";
import { RealtimeMetrics } from "../src/metrics";

const COALESCE_MS = 150;

/** One delivered frame: which socket got it, and the count it carried. */
interface Frame {
  ws: WebSocket;
  count: number;
}

/**
 * A socket stand-in. The broadcaster only ever calls `send()`, which `attach()`
 * wires to the frame recorder; the cast keeps the production dependency type
 * (the runtime `WebSocket`) without a Worker.
 */
function fakeSocket(): WebSocket {
  return {} as unknown as WebSocket;
}

class FakeRoom {
  readonly sockets: WebSocket[] = [];
  readonly byUser = new Map<string, Set<WebSocket>>();
  readonly frames: Frame[] = [];
  generation = 0;

  /** Attach a socket for a member — the same bookkeeping SocketRegistry does. */
  attach(userId: string): WebSocket {
    const ws = fakeSocket();
    const raw = ws as unknown as { send: (message: string) => void };
    raw.send = (message: string) => {
      const parsed = JSON.parse(message) as { t: string; count: number };
      this.frames.push({ ws, count: parsed.count });
    };
    this.sockets.push(ws);
    let set = this.byUser.get(userId);
    if (!set) {
      set = new Set();
      this.byUser.set(userId, set);
    }
    set.add(ws);
    this.generation += 1;
    return ws;
  }

  /** Remove a socket — a tab closing, a reconnect, a failed send. */
  detach(ws: WebSocket): void {
    const index = this.sockets.indexOf(ws);
    if (index === -1) return;
    this.sockets.splice(index, 1);
    for (const [userId, set] of this.byUser) {
      if (!set.delete(ws)) continue;
      if (set.size === 0) this.byUser.delete(userId);
      break;
    }
    this.generation += 1;
  }

  framesFor(ws: WebSocket): Frame[] {
    return this.frames.filter((frame) => frame.ws === ws);
  }
}

function build(room: FakeRoom) {
  const metrics = new RealtimeMetrics();
  const broadcaster = new PresenceBroadcaster({
    getSockets: () => [...room.sockets],
    socketsByUser: room.byUser,
    socketGeneration: () => room.generation,
    roomName: "chat:presence-broadcast",
    metrics,
    onSendFailed: (ws) => room.detach(ws),
  });
  return { broadcaster, metrics };
}

/** Let one coalescing window elapse (and any lap it schedules). */
function flushWindow(): void {
  for (let i = 0; i < 5; i += 1) vi.advanceTimersByTime(COALESCE_MS);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("presence is re-broadcast when the socket population moves", () => {
  it("tells a member's second socket, though the member count did not move", () => {
    const room = new FakeRoom();
    const { broadcaster, metrics } = build(room);

    const first = room.attach("alice");
    broadcaster.markPresenceDirty();
    flushWindow();
    expect(room.framesFor(first).map((frame) => frame.count)).toEqual([1]);
    const skippedBefore = metrics.presenceSkipped;

    // A second tab for the same member: still one member online.
    const second = room.attach("alice");
    broadcaster.markPresenceDirty();
    flushWindow();

    expect(room.framesFor(second).map((frame) => frame.count)).toEqual([1]);
    // …and it was a real broadcast, not the settled-count shortcut.
    expect(metrics.presenceSkipped).toBe(skippedBefore);
  });

  it("tells the socket that replaces another member's socket inside one window", () => {
    const room = new FakeRoom();
    const { broadcaster } = build(room);

    const alice = room.attach("alice");
    const bob = room.attach("bob");
    broadcaster.markPresenceDirty();
    flushWindow();
    expect(room.framesFor(bob).at(-1)?.count).toBe(2);

    // Alice leaves and Carol joins before the next flush: two members before,
    // two members after, and the same number of sockets.
    room.detach(alice);
    const carol = room.attach("carol");
    broadcaster.markPresenceDirty();
    flushWindow();

    expect(room.framesFor(carol).map((frame) => frame.count)).toEqual([2]);
  });

  it("tells the next member to arrive after the room empties", () => {
    const room = new FakeRoom();
    const { broadcaster } = build(room);

    const first = room.attach("alice");
    broadcaster.markPresenceDirty();
    flushWindow();
    expect(room.framesFor(first)).toHaveLength(1);

    room.detach(first);
    broadcaster.markPresenceDirty();
    flushWindow();

    const next = room.attach("bob");
    broadcaster.markPresenceDirty();
    flushWindow();
    expect(room.framesFor(next).map((frame) => frame.count)).toEqual([1]);
  });
});

describe("presence still skips an unchanged count on an unchanged room", () => {
  it("does not re-broadcast while neither the count nor the sockets move", () => {
    const room = new FakeRoom();
    const { broadcaster, metrics } = build(room);

    const alice = room.attach("alice");
    const bob = room.attach("bob");
    broadcaster.markPresenceDirty();
    flushWindow();
    expect(room.framesFor(alice).at(-1)?.count).toBe(2);

    const broadcastsBefore = room.frames.length;
    const skippedBefore = metrics.presenceSkipped;

    // A `join` frame re-stamps a member's metadata without changing who is
    // online — the settled count already sits on both sockets.
    broadcaster.markPresenceDirty();
    flushWindow();

    expect(room.frames.length).toBe(broadcastsBefore);
    expect(metrics.presenceSkipped).toBe(skippedBefore + 1);
  });
});
