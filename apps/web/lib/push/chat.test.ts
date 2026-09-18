/**
 * Tests for the two decisions that make chat push bearable: when a member is
 * allowed to be buzzed, and when their quiet hours are.
 *
 * Both are pure functions on purpose — they are the parts most likely to be
 * got subtly wrong (timezone arithmetic, a window that never resets) and the
 * parts a database cannot tell us anything about.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AUDIBLE_MAX,
  AUDIBLE_WINDOW_MS,
  isWithinQuietHours,
  nextPushBudget,
  type QuietHoursInput,
} from "./chat";

// ---------------------------------------------------------------------------
// Audible-push budget
// ---------------------------------------------------------------------------

test("the first push of a window buzzes", () => {
  const budget = nextPushBudget(undefined, 1_000_000);
  assert.equal(budget.sentCount, 1);
  assert.equal(budget.withinBudget, true);
  assert.equal(budget.windowStartedAt, 1_000_000);
});

test("pushes up to the cap still buzz", () => {
  let state = { windowStartedAt: 1_000_000, count: 1 };
  for (let i = 2; i <= AUDIBLE_MAX; i += 1) {
    const budget = nextPushBudget(state, 1_000_000 + i);
    assert.equal(budget.sentCount, i);
    assert.equal(budget.withinBudget, true, `push ${i} should still be audible`);
    state = { windowStartedAt: budget.windowStartedAt, count: budget.sentCount };
  }
});

test("pushes past the cap go silent", () => {
  const budget = nextPushBudget(
    { windowStartedAt: 1_000_000, count: AUDIBLE_MAX },
    1_000_000 + 10,
  );
  assert.equal(budget.sentCount, AUDIBLE_MAX + 1);
  assert.equal(budget.withinBudget, false);
});

test("the window resets after it elapses", () => {
  const previous = { windowStartedAt: 1_000_000, count: 40 };
  const budget = nextPushBudget(previous, 1_000_000 + AUDIBLE_WINDOW_MS);
  assert.equal(budget.sentCount, 1);
  assert.equal(budget.withinBudget, true);
  assert.equal(budget.windowStartedAt, 1_000_000 + AUDIBLE_WINDOW_MS);
});

test("the window does not reset a millisecond early", () => {
  const budget = nextPushBudget(
    { windowStartedAt: 1_000_000, count: 40 },
    1_000_000 + AUDIBLE_WINDOW_MS - 1,
  );
  assert.equal(budget.sentCount, 41);
  assert.equal(budget.withinBudget, false);
  // The window keeps its original start, so it does not slide forward.
  assert.equal(budget.windowStartedAt, 1_000_000);
});

test("a long-lived window keeps counting instead of restarting", () => {
  let state = { windowStartedAt: 0, count: 3 };
  for (let i = 4; i <= 20; i += 1) {
    const budget = nextPushBudget(state, i * 1_000);
    assert.equal(budget.sentCount, i);
    assert.equal(budget.withinBudget, false);
    state = { windowStartedAt: budget.windowStartedAt, count: budget.sentCount };
  }
});

// ---------------------------------------------------------------------------
// Quiet hours
// ---------------------------------------------------------------------------

/** 22:00 → 07:00 in Asia/Kolkata (UTC+05:30), the common overnight case. */
const overnight: QuietHoursInput = {
  quiet_hours_enabled: true,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
  quiet_hours_timezone: "Asia/Kolkata",
};

test("quiet hours are ignored when disabled", () => {
  assert.equal(
    isWithinQuietHours(
      { ...overnight, quiet_hours_enabled: false },
      new Date("2026-09-18T17:00:00Z"),
    ),
    false,
  );
});

test("an overnight window is quiet inside it", () => {
  // 22:30 IST.
  assert.equal(isWithinQuietHours(overnight, new Date("2026-09-18T17:00:00Z")), true);
});

test("an overnight window is not quiet just before it starts", () => {
  // 21:59 IST.
  assert.equal(isWithinQuietHours(overnight, new Date("2026-09-18T16:29:00Z")), false);
});

test("an overnight window stays quiet past midnight", () => {
  // 06:59 IST.
  assert.equal(isWithinQuietHours(overnight, new Date("2026-09-18T01:29:00Z")), true);
});

test("the end of a quiet window is exclusive", () => {
  // 07:00 IST.
  assert.equal(isWithinQuietHours(overnight, new Date("2026-09-18T01:30:00Z")), false);
});

test("a same-day window only covers its own hours", () => {
  const daytime: QuietHoursInput = {
    ...overnight,
    quiet_hours_start: "09:00",
    quiet_hours_end: "17:00",
  };
  // 12:00 IST is inside; 18:30 IST is not.
  assert.equal(isWithinQuietHours(daytime, new Date("2026-09-18T06:30:00Z")), true);
  assert.equal(isWithinQuietHours(daytime, new Date("2026-09-18T13:00:00Z")), false);
});

test("identical bounds never swallow the whole day", () => {
  assert.equal(
    isWithinQuietHours(
      { ...overnight, quiet_hours_start: "22:00", quiet_hours_end: "22:00" },
      new Date("2026-09-18T17:00:00Z"),
    ),
    false,
  );
});

test("quiet hours are evaluated in the member's timezone, not the server's", () => {
  const utc: QuietHoursInput = { ...overnight, quiet_hours_timezone: "UTC" };
  // 23:00 UTC is inside the window; 12:00 UTC is the same window's quiet
  // opposite — the two instants differ only by the zone the member saved.
  assert.equal(isWithinQuietHours(utc, new Date("2026-09-18T23:00:00Z")), true);
  assert.equal(isWithinQuietHours(utc, new Date("2026-09-18T12:00:00Z")), false);
});

test("an unusable timezone fails open", () => {
  assert.equal(
    isWithinQuietHours(
      { ...overnight, quiet_hours_timezone: "Not/AZone" },
      new Date("2026-09-18T17:00:00Z"),
    ),
    false,
  );
});

test("unparseable bounds fail open", () => {
  assert.equal(
    isWithinQuietHours({ ...overnight, quiet_hours_start: null }, new Date("2026-09-18T17:00:00Z")),
    false,
  );
  assert.equal(
    isWithinQuietHours(
      { ...overnight, quiet_hours_end: "not a clock" },
      new Date("2026-09-18T17:00:00Z"),
    ),
    false,
  );
});

test("seconds in a time column are tolerated", () => {
  // Postgres hands back "22:00:00"; the parser must not choke on it.
  assert.equal(
    isWithinQuietHours({ ...overnight, quiet_hours_start: "22:00:00" }, new Date("2026-09-18T17:00:00Z")),
    true,
  );
});
