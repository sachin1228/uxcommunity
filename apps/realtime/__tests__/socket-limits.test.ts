import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_SOCKETS_PER_SESSION,
  DEFAULT_MAX_SOCKETS_PER_USER,
  chooseSocketEvictions,
  readSocketLimit,
} from "../src/socket-limits";

function sockets(...sids: string[]) {
  return sids.map((sid) => ({ sid }));
}

describe("chooseSocketEvictions", () => {
  it("evicts the oldest same-session socket when the session cap is reached", () => {
    const existing = sockets("a", "a", "a");
    expect(
      chooseSocketEvictions(existing, "a", { perUser: 12, perSession: 3 }),
    ).toEqual([0]);
  });

  it("evicts the oldest user socket across devices when the user cap is reached", () => {
    const existing = sockets("phone", "laptop", "tablet");
    expect(
      chooseSocketEvictions(existing, "new-tab", { perUser: 3, perSession: 8 }),
    ).toEqual([0]);
  });

  it("keeps multiple devices below the user cap", () => {
    const existing = sockets("phone", "laptop");
    expect(
      chooseSocketEvictions(existing, "tablet", { perUser: 3, perSession: 8 }),
    ).toEqual([]);
  });

  it("a reconnecting tab replaces its stale socket instead of being refused", () => {
    const existing = sockets("same-tab", "other-device");
    // Same session at its cap: drop the oldest same-session socket, not the
    // other device.
    expect(
      chooseSocketEvictions(existing, "same-tab", { perUser: 4, perSession: 1 }),
    ).toEqual([0]);
  });

  it("cleans up an over-limit room (after a config change) in one pass", () => {
    const existing = sockets("a", "b", "c", "d");
    // perUser 2: two of the four must go; the session cap is irrelevant here.
    const evicted = chooseSocketEvictions(existing, "new", {
      perUser: 2,
      perSession: 8,
    });
    // One existing socket must remain to sit beside the incoming one.
    expect(evicted).toHaveLength(3);
    expect(evicted).toEqual([0, 1, 2]);
  });

  it("keeps the defaults sane for real multi-device use", () => {
    expect(DEFAULT_MAX_SOCKETS_PER_USER).toBeGreaterThan(DEFAULT_MAX_SOCKETS_PER_SESSION);
    expect(DEFAULT_MAX_SOCKETS_PER_SESSION).toBeGreaterThanOrEqual(4);
  });
});

describe("readSocketLimit", () => {
  it("uses a fallback for missing or invalid values", () => {
    expect(readSocketLimit(undefined, 12, 1, 100)).toBe(12);
    expect(readSocketLimit("nope", 12, 1, 100)).toBe(12);
  });

  it("clamps to the safe range", () => {
    expect(readSocketLimit("0", 12, 1, 100)).toBe(1);
    expect(readSocketLimit("1000", 12, 1, 100)).toBe(100);
    expect(readSocketLimit("7.9", 12, 1, 100)).toBe(7);
  });
});
