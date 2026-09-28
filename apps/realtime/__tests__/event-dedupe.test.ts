/**
 * Unit tests for `EventIdDedupe` (production-readiness audit, M-1).
 *
 * The retry path reuses an event's id, so the DO must apply an id once and drop
 * the replay — without growing a permanent record per event.
 */

import { describe, expect, it } from "vitest";
import { EventIdDedupe } from "../src/event-dedupe";

describe("EventIdDedupe", () => {
  it("accepts a new id once and rejects the retry of the same id", () => {
    const dedupe = new EventIdDedupe();
    const now = 1_000;

    expect(dedupe.accept("evt-1", now)).toBe(true);
    expect(dedupe.accept("evt-1", now + 10)).toBe(false);
    expect(dedupe.accept("evt-1", now + 20)).toBe(false);
  });

  it("accepts distinct ids independently", () => {
    const dedupe = new EventIdDedupe();
    expect(dedupe.accept("a", 0)).toBe(true);
    expect(dedupe.accept("b", 0)).toBe(true);
    expect(dedupe.accept("a", 0)).toBe(false);
  });

  it("forgets an id once its TTL passes", () => {
    const dedupe = new EventIdDedupe(100, 1_000);
    expect(dedupe.accept("evt", 0)).toBe(true);
    expect(dedupe.accept("evt", 999)).toBe(false);
    // Exactly at the TTL boundary it is considered expired (>= ttl).
    expect(dedupe.accept("evt", 1_000)).toBe(true);
  });

  it("stays bounded by evicting the oldest ids", () => {
    const dedupe = new EventIdDedupe(3, 60_000);
    for (let i = 0; i < 10; i += 1) dedupe.accept(`evt-${i}`, i);

    expect(dedupe.size).toBe(3);
    // The oldest three are gone, so they look new again — bounded memory is the
    // tradeoff, and the retry window is far shorter than 10 events.
    expect(dedupe.accept("evt-0", 10)).toBe(true);
    // The most recent ids are still remembered.
    expect(dedupe.accept("evt-9", 10)).toBe(false);
  });

  it("prunes expired entries so memory does not grow with traffic", () => {
    const dedupe = new EventIdDedupe(1_000, 1_000);
    dedupe.accept("old", 0);
    expect(dedupe.size).toBe(1);
    dedupe.accept("new", 5_000);
    expect(dedupe.size).toBe(1); // "old" was pruned before "new" was added
  });
});
