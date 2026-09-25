import { test } from "node:test";
import assert from "node:assert/strict";
import {
  localInputToIso,
  isoToLocalInput,
  isZoneAwareIso,
  requireZoneAwareIso,
  todayDateInput,
  nowTimeInput,
  addDaysToDateInput,
  daysBetweenDateInputs,
  isPastStart,
  startMovedByEdit,
} from "./event-time";

/**
 * Runs the conversion with the browser's zone frozen to a fixed offset, so the
 * assertions hold no matter where the suite runs. process.env.TZ is read when
 * V8 first needs a zone, so setting it before any Date work pins the process.
 */
function withZone<T>(tz: string, run: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return run();
  } finally {
    process.env.TZ = previous;
    // New Date() calls after this point re-read the zone.
    const probe = new Date(0);
    void probe;
  }
}

test("a typed wall time becomes the real instant it names in the viewer's zone", () => {
  withZone("Asia/Kolkata", () => {
    // 12:10 IST is 06:40 UTC.
    assert.equal(localInputToIso("2026-09-25", "12:10"), "2026-09-25T12:10:00+05:30");
  });
});

test("the same wall time yields a different instant in a different zone", () => {
  withZone("America/New_York", () => {
    // 12:10 EDT (UTC-4) is 16:10 UTC.
    assert.equal(localInputToIso("2026-09-25", "12:10"), "2026-09-25T12:10:00-04:00");
  });
});

test("UTC itself is stated explicitly rather than left bare", () => {
  withZone("UTC", () => {
    assert.equal(localInputToIso("2026-09-25", "12:10"), "2026-09-25T12:10:00Z".replace("Z", "+00:00"));
  });
});

test("DST is derived from the date, not assumed", () => {
  withZone("America/New_York", () => {
    // 2026-01-15 is EST (UTC-5); 2026-07-15 is EDT (UTC-4).
    assert.equal(localInputToIso("2026-01-15", "09:30"), "2026-01-15T09:30:00-05:00");
    assert.equal(localInputToIso("2026-07-15", "09:30"), "2026-07-15T09:30:00-04:00");
  });
});

test("midnight is hour 00, not the locale's 24", () => {
  withZone("Asia/Kolkata", () => {
    assert.equal(localInputToIso("2026-09-25", "00:00"), "2026-09-25T00:00:00+05:30");
  });
});

test("round-trips through the stored UTC instant", () => {
  withZone("Asia/Kolkata", () => {
    const iso = localInputToIso("2026-09-25", "12:10")!;
    const back = isoToLocalInput(new Date(iso).toISOString());
    assert.deepEqual(back, { date: "2026-09-25", time: "12:10" });
  });
});

test("malformed inputs convert to nothing rather than a wrong instant", () => {
  assert.equal(localInputToIso("", "12:10"), null);
  assert.equal(localInputToIso("2026-09-25", ""), null);
  assert.equal(localInputToIso("25/09/2026", "12:10"), null);
  assert.equal(localInputToIso("2026-09-25", "25:10"), null);
});

test("the zone-less shape that caused the shift is rejected", () => {
  assert.equal(isZoneAwareIso("2026-09-25T12:10:00"), false);
  assert.equal(isZoneAwareIso("2026-09-25T12:10"), false);
  assert.equal(isZoneAwareIso("2026-09-25T12:10:00Z"), true);
  assert.equal(isZoneAwareIso("2026-09-25T12:10:00+05:30"), true);
  assert.equal(isZoneAwareIso("2026-09-25T12:10:00.000Z"), true);
});

test("requireZoneAwareIso guards and normalises in one step", () => {
  assert.equal(requireZoneAwareIso("2026-09-25T12:10:00"), null);
  assert.equal(requireZoneAwareIso("2026-09-25T12:10:00+05:30"), "2026-09-25T06:40:00.000Z");
  assert.equal(requireZoneAwareIso("not a date"), null);
});

test("todayDateInput is the viewer's calendar day, not UTC's", () => {
  // 2026-09-25 01:10 IST is still 2026-09-24 in UTC — the zone decides the day.
  const now = new Date("2026-09-25T01:10:00+05:30");
  withZone("Asia/Kolkata", () => {
    assert.equal(todayDateInput(now), "2026-09-25");
  });
  withZone("America/Los_Angeles", () => {
    // That same instant is the previous afternoon in Los Angeles.
    assert.equal(todayDateInput(now), "2026-09-24");
  });
});

test("a start that already happened is past, with a minute of grace", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  // A minute ago still counts as about-to-start…
  assert.equal(isPastStart("2026-09-25T11:59:30Z", now), false);
  // …an hour ago does not.
  assert.equal(isPastStart("2026-09-25T11:00:00Z", now), true);
  // Anything from here on is upcoming.
  assert.equal(isPastStart("2026-09-25T12:00:00Z", now), false);
  assert.equal(isPastStart("2099-12-31T18:00:00Z", now), false);
});

test("an unparseable start counts as past — fail closed on dates", () => {
  assert.equal(isPastStart("not a date"), true);
  assert.equal(isPastStart(""), true);
});

test("nowTimeInput reads the viewer's wall clock, minutes only", () => {
  withZone("Asia/Kolkata", () => {
    assert.equal(nowTimeInput(new Date("2026-09-25T14:05:00+05:30")), "14:05");
    assert.equal(nowTimeInput(new Date("2026-09-25T08:00:00+05:30")), "08:00");
  });
});

test("addDaysToDateInput shifts whole days on the string's own calendar", () => {
  assert.equal(addDaysToDateInput("2026-09-25", 2), "2026-09-27");
  assert.equal(addDaysToDateInput("2026-09-30", 1), "2026-10-01");
  assert.equal(addDaysToDateInput("2026-03-01", -1), "2026-02-28");
  assert.equal(addDaysToDateInput("2024-03-01", -1), "2024-02-29"); // leap year
  assert.equal(addDaysToDateInput("nonsense", 1), "nonsense");
});

test("daysBetweenDateInputs counts the gap between two date strings", () => {
  assert.equal(daysBetweenDateInputs("2026-09-25", "2026-09-25"), 0);
  assert.equal(daysBetweenDateInputs("2026-09-25", "2026-09-27"), 2);
  assert.equal(daysBetweenDateInputs("2026-09-27", "2026-09-25"), -2);
});

test("an unmodified stored start does not count as moved by an edit", () => {
  const iso = "2026-09-25T06:40:00.000Z";
  assert.equal(startMovedByEdit(iso, iso), false);
  // Sub-minute differences are the form's own rounding, not a change.
  assert.equal(startMovedByEdit("2026-09-25T06:40:30.000Z", "2026-09-25T06:40:00.000Z"), false);
  assert.equal(startMovedByEdit("2026-09-26T06:40:00.000Z", iso), true);
  // Garbage on either side must not silently unlock the past.
  assert.equal(startMovedByEdit("not a date", iso), true);
  assert.equal(startMovedByEdit(iso, ""), true);
});
