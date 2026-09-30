/**
 * Presence broadcasts for the community Durable Object.
 *
 * WHAT PRESENCE IS
 *   A coarse online-member count. The payload is a single number (see
 *   `encodePresenceFrame`): the only presence consumer in the product renders
 *   "N online", so a roster added nothing but bytes, and writing one serialized
 *   roster per socket per flush was quadratic in room size.
 *
 * WHY THIS EXISTS AS A MODULE
 *   The count is broadcast, so it has to reach the whole room, and doing that
 *   naively is what starved the Durable Object under the 5K ladder. Keeping it
 *   correct therefore takes a small amount of state that has nothing to do with
 *   the rest of the room: a coalescing timer, a dirty flag, a lap cursor and the
 *   bookkeeping that decides whether a lap actually settled the room. That state
 *   used to be eight fields and two methods of private state inside the 849-line
 *   community DO, interleaved with membership, publish security and fan-out.
 *
 *   This module owns that algorithm and nothing else. It is not a generic
 *   "broadcaster": when a member's public-level typing flag is published in the
 *   future, that will not live here. It is not responsible for a member's
 *   multi-device relay; only the count broadcast, which is the only traffic this
 *   module owns.
 *
 * THE ALGORITHM (frozen — the 5K realtime validation measured this)
 *   1. A join or close marks presence dirty and schedules ONE flush
 *      `PRESENCE_COALESCE_MS` later; further marks inside the window are
 *      collapsed into that flush.
 *   2. Each flush writes the count to at most `PRESENCE_FLUSH_BUDGET` sockets,
 *      the first N by cursor; if the room is larger, the cursor advances and the
 *      rest is owed this same count next window — a lap over the room.
 *   3. A lap only records the count as "stable on every socket" when neither the
 *      count nor the socket population changed while it ran. Otherwise another
 *      window is scheduled. The cursor is never reset, so a busy room keeps
 *      advancing rather than re-refreshing its first window forever. A settled
 *      count is ONLY reused while the socket population is unchanged
 *      (`socketGeneration`): a replaced tab has never been told the count, and a
 *      member count does not move when one tab replaces another, so "same count"
 *      alone would leave that socket showing nothing.
 *   4. A flush with no attached sockets clears the lap bookkeeping, so the next
 *      socket to arrive is told a fresh count.
 *
 * DEPENDENCY DIRECTION
 *   This module is downstream of the socket registry (who is online) and of the
 *   metrics object (which it increments, never owns). It cannot evict a socket:
 *   a failed `send()` means the socket has to leave the subscription index, the
 *   registry and the rate limiters as well, so the DO passes `onSendFailed` and
 *   keeps ownership of that teardown. Nothing in this file knows about
 *   membership, subscriptions, publish or routing.
 *
 * The counter names it writes are part of the operational contract: presence
 * traffic is reported separately from event fan-out (`deliverAttempts` counts
 * event sends only), which is what makes "the cost of one publish" readable.
 */

import type { RealtimeMetrics } from "./metrics";
import { countOnlineUsers } from "./subscriptions";
import { encodePresenceFrame } from "./wire";

/**
 * How long presence changes are allowed to coalesce.
 *
 * Presence is a coarse online-member count: a 150 ms delay is imperceptible,
 * while flushing per join/close made a reconnect storm quadratic (N connections
 * produced N flushes × N sockets). Coalescing bounds the flush count; the count
 * payload bounds each flush.
 */
const PRESENCE_COALESCE_MS = 150;

/**
 * How many sockets one presence flush may write to.
 *
 * A count has to reach every attached socket, so a flush is inherently O(room)
 * work. Doing all of it inside one timer callback is what starved the Durable
 * Object in the H-3 5K ladder: at 4,351 attached sockets the flush wrote the
 * room back to back, the object could not interleave upgrades and queued `join`
 * frames with it (only 42 of 4,351 sockets ever got their `hello`), and the room
 * was lost.
 *
 * Capping the window bounds the work one presence change can impose on the
 * object. A room at or below the cap still delivers every change in a single
 * window — identical behaviour for normal-sized communities — and a larger room
 * rotates: the cursor advances by the cap each window (~150 ms), so a
 * 5,000-socket room converges on the current count within ~3 s.
 */
const PRESENCE_FLUSH_BUDGET = 256;

export interface PresenceBroadcasterDeps {
  /** Attached sockets, read fresh per flush (the lap walks this array). */
  getSockets: () => WebSocket[];
  /** Sockets per user, folded into the online-member count. */
  socketsByUser: ReadonlyMap<string, ReadonlySet<WebSocket>>;
  /**
   * Monotonic count of socket attaches and detaches (see socket-registry.ts).
   *
   * The online-member count does not move when one socket replaces another — a
   * tab reload, a reconnect, a second device — but the socket that arrived has
   * never been told the count. Comparing this against the generation a settled
   * lap measured is what makes "the count is already on every socket" a fact
   * about the sockets rather than a guess from the number alone.
   */
  socketGeneration: () => number;
  /** The room's name, carried on the frame so a client can route it. */
  roomName: string;
  /** The DO's counters. Presence increments them, never owns them. */
  metrics: RealtimeMetrics;
  /** Evict a socket whose `send()` failed (owned by the DO — see above). */
  onSendFailed: (ws: WebSocket) => void;
}

export class PresenceBroadcaster {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  /** Next socket index still owed the current count; 0 starts a lap. */
  private cursor = 0;
  /** Last observed online count — how a change is noticed between flushes. */
  private seenCount: number | null = null;
  /** Count a finished clean lap proved to sit on every attached socket. */
  private stableCount: number | null = null;
  /** Socket generation that clean lap measured (see `socketGeneration` dep). */
  private stableGeneration: number | null = null;
  /** Bumped whenever the observed count changes. */
  private changeSeq = 0;
  /** Change sequence and socket population captured when the current lap started. */
  private lapChanges = 0;
  private lapSockets = 0;
  private lapGeneration = 0;

  constructor(private readonly deps: PresenceBroadcasterDeps) {}

  /**
   * Mark presence as changed and schedule a flush.
   *
   * Joins and closes are coalesced into one count per window: before this, a
   * reconnect storm sent a message (with an attachment deserialization per
   * socket, twice) for every single join and close.
   */
  markPresenceDirty(): void {
    this.dirty = true;
    if (this.timer !== null) {
      this.deps.metrics.presenceCoalesced += 1;
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flushPresence();
    }, PRESENCE_COALESCE_MS);
  }

  /**
   * Send the room's online-member count to the next window of sockets.
   *
   * The payload is a single number by design (see `countOnlineUsers`): the only
   * presence consumer in the product renders "N online", so a roster added
   * nothing but bytes. The work per flush is capped at `PRESENCE_FLUSH_BUDGET`
   * sends (see that constant for why), so a room larger than the cap is told the
   * count one window at a time — a lap over the room — until every attached
   * socket holds it.
   *
   * A lap only proves delivery when neither the count nor the socket population
   * moved while it ran; a change landing mid-lap runs another lap instead of
   * declaring the room settled. The cursor is never reset, so a busy room keeps
   * advancing through its sockets rather than refreshing the same first window
   * on every change.
   *
   * A settled count is reused (skipped) only while the socket population is
   * unchanged. Otherwise a member whose tab reloaded, reconnected, or opened a
   * second one would sit at zero: their count never moved, so nothing would be
   * sent, and the socket that just arrived would never be told.
   */
  private flushPresence(): void {
    if (!this.dirty) return;
    this.dirty = false;

    const sockets = this.deps.getSockets();
    if (sockets.length === 0) {
      // Nothing to tell, and a socket that arrives later must be told afresh.
      this.cursor = 0;
      this.seenCount = null;
      this.stableCount = null;
      this.stableGeneration = null;
      return;
    }

    const count = countOnlineUsers(this.deps.socketsByUser);
    if (count !== this.seenCount) {
      this.seenCount = count;
      this.changeSeq += 1;
      this.deps.metrics.presenceCountChanges += 1;
    }

    const startingLap = this.cursor === 0;
    // Idle room: every socket holds this count, on this socket population, and
    // no lap is in progress. Both halves are required — the count alone does not
    // say which sockets were told it.
    if (
      startingLap &&
      count === this.stableCount &&
      this.deps.socketGeneration() === this.stableGeneration
    ) {
      this.deps.metrics.presenceSkipped += 1;
      return;
    }
    if (startingLap) {
      this.lapChanges = this.changeSeq;
      this.lapSockets = sockets.length;
      this.lapGeneration = this.deps.socketGeneration();
    }

    const message = encodePresenceFrame(this.deps.roomName, count);
    const messageBytes = message.length;

    const end = Math.min(sockets.length, this.cursor + PRESENCE_FLUSH_BUDGET);
    for (let index = this.cursor; index < end; index += 1) {
      const ws = sockets[index];
      if (!ws) continue;
      // Counted separately from event fan-out: this addresses the whole room, so
      // folding it into `deliverAttempts` would hide the cost of a publish.
      this.deps.metrics.presenceDeliverAttempts += 1;
      try {
        ws.send(message);
        this.deps.metrics.presencePayloadBytes += messageBytes;
      } catch {
        // A dead socket is evicted; the next flush publishes a fresh count.
        this.deps.onSendFailed(ws);
      }
    }
    this.deps.metrics.presenceBroadcasts += 1;

    if (end < sockets.length) {
      // Budget spent: the rest of the room is owed this count.
      this.cursor = end;
      this.deps.metrics.presenceDeferredWindows += 1;
      this.markPresenceDirty();
      return;
    }

    this.cursor = 0;
    if (
      this.changeSeq === this.lapChanges &&
      sockets.length === this.lapSockets &&
      this.deps.socketGeneration() === this.lapGeneration
    ) {
      this.stableCount = count;
      this.stableGeneration = this.lapGeneration;
    } else {
      this.markPresenceDirty();
    }
  }
}
