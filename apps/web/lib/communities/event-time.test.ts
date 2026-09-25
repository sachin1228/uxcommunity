import { test } from "node:test";
import assert from "node:assert/strict";
import { localInputToIso, isoToLocalInput, isZoneAwareIso, requireZoneAwareIso } from "./event-time";

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
