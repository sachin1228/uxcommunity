import assert from "node:assert/strict";
import test from "node:test";
import { validateEventSchedule } from "./event-schedule";

const NOW = Date.parse("2026-10-31T12:00:00.000Z");

test("a valid future schedule passes", () => {
  assert.equal(
    validateEventSchedule({
      start: "2026-11-01T12:00:00.000Z",
      end: "2026-11-01T14:00:00.000Z",
      requireFutureStart: true,
      now: NOW,
    }),
    null,
  );
});

test("an end at or before the start is rejected", () => {
  assert.equal(
    validateEventSchedule({
      start: "2026-11-01T12:00:00.000Z",
      end: "2026-11-01T12:00:00.000Z",
      requireFutureStart: true,
      now: NOW,
    }),
    "end_before_start",
  );
});

test("a newly chosen past start is rejected", () => {
  assert.equal(
    validateEventSchedule({
      start: "2026-10-30T12:00:00.000Z",
      end: null,
      requireFutureStart: true,
      now: NOW,
    }),
    "start_in_past",
  );
});

test("editing an ongoing event's description does not require a future start", () => {
  assert.equal(
    validateEventSchedule({
      start: "2026-10-30T12:00:00.000Z",
      end: "2026-10-30T14:00:00.000Z",
      requireFutureStart: false,
      now: NOW,
    }),
    null,
  );
});
