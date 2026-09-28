/**
 * Bounded, TTL'd de-duplication of server-published events.
 *
 * WHY THIS EXISTS (production-readiness audit, M-1)
 *   Fan-out retries reuse the publisher's `event_id`. Without a guard, a retry
 *   that races a first attempt that actually succeeded would deliver the event
 *   twice. This keeps a short memory of the event ids a room has already
 *   applied so the second delivery is dropped instead of broadcast.
 *
 * BOUNDS
 *   The map holds at most `maxEntries` ids (FIFO eviction) and forgets an id
 *   after `ttlMs`. Both bounds are required: a busy room must not grow one
 *   entry per event forever, and an id only needs to be remembered for as long
 *   as a retry could plausibly arrive (the retry budget is well under a
 *   second; the TTL is minutes of headroom). The state is in-memory per DO
 *   instance and dies with it — dedup only has to cover the retry window, and a
 *   hibernation is far longer than that.
 *
 * Kept dependency-free so the behaviour can be unit-tested without a Worker.
 */

export class EventIdDedupe {
  private readonly seen = new Map<string, number>();

  constructor(
    private readonly maxEntries = 2_048,
    private readonly ttlMs = 5 * 60_000,
  ) {}

  /**
   * Record `id` and report whether it is new.
   *
   * Returns `true` when the caller should process the event, `false` when it is
   * a replay of an id already applied within the TTL.
   */
  accept(id: string, now = Date.now()): boolean {
    this.prune(now);
    const previous = this.seen.get(id);
    if (previous !== undefined && now - previous < this.ttlMs) return false;
    if (previous !== undefined) this.seen.delete(id);

    this.seen.set(id, now);
    while (this.seen.size > this.maxEntries) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
    return true;
  }

  /** Number of remembered ids (bounded by `maxEntries`). */
  get size(): number {
    return this.seen.size;
  }

  /** Drop expired ids. Called on every `accept`, exposed for tests. */
  prune(now = Date.now()): void {
    for (const [id, ts] of this.seen) {
      if (now - ts >= this.ttlMs) this.seen.delete(id);
    }
  }
}
