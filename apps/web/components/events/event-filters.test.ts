import assert from "node:assert/strict"
import test from "node:test"

import { dateWindow, filterQuery } from "./event-filters"

// ─── dateWindow ──────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** A wall-clock moment, so the expectations are the viewer's own boundaries. */
function local(y: number, m: number, d: number, h = 0, min = 0) {
  return new Date(y, m, d, h, min);
}

test("any date carries no bounds", () => {
  assert.deepEqual(dateWindow("any", local(2026, 9, 10, 14)), { from: null, to: null });
});

test("today is the local day containing the clock", () => {
  const { from, to } = dateWindow("today", local(2026, 9, 10, 23, 59));
  assert.ok(from && to);
  assert.deepEqual(new Date(from), local(2026, 9, 10));
  assert.deepEqual(new Date(to), local(2026, 9, 11));
  assert.equal(new Date(to).getTime() - new Date(from).getTime(), DAY_MS);
});

test("this week starts Monday and runs seven days", () => {
  // 2026-10-10 is a Saturday; its week starts Monday 2026-10-05.
  const { from, to } = dateWindow("week", local(2026, 9, 10, 14));
  assert.deepEqual(new Date(from!), local(2026, 9, 5));
  assert.deepEqual(new Date(to!), local(2026, 9, 12));
  // A Monday itself stays inside its own week.
  const monday = dateWindow("week", local(2026, 9, 5, 9));
  assert.deepEqual(new Date(monday.from!), local(2026, 9, 5));
});

test("this month is the local calendar month", () => {
  const { from, to } = dateWindow("month", local(2026, 9, 10, 14));
  assert.deepEqual(new Date(from!), local(2026, 9, 1));
  assert.deepEqual(new Date(to!), local(2026, 10, 1));
});

// ─── filterQuery ─────────────────────────────────────────────────────────────

test("no filters produce an empty query", () => {
  assert.equal(filterQuery("all", "any", local(2026, 9, 10)).toString(), "");
});

test("type and date filters land as parameters", () => {
  const params = filterQuery("in-person", "today", local(2026, 9, 10, 14));
  assert.equal(params.get("type"), "in-person");
  assert.equal(params.get("from"), dateWindow("today", local(2026, 9, 10, 14)).from);
  assert.equal(params.get("to"), dateWindow("today", local(2026, 9, 10, 14)).to);
});

test("a type filter alone carries only the type", () => {
  const params = filterQuery("online", "any", local(2026, 9, 10));
  assert.equal(params.get("type"), "online");
  assert.equal(params.get("from"), null);
  assert.equal(params.get("to"), null);
});
