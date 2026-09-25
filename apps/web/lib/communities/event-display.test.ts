import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatEventTime,
  formatEventTimeRange,
  eventZoneLabel,
  eventZoneTooltip,
} from "./event-display";

/**
 * Runs the assertions with the browser's zone frozen to a fixed offset, so the
 * expected strings hold wherever the suite runs — the same pattern the
 * event-time suite uses (V8 re-reads process.env.TZ between Date calls).
 */
function withZone<T>(tz: string, run: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = tz;
  try {
    return run();
  } finally {
    process.env.TZ = previous;
    const probe = new Date(0);
    void probe;
  }
}

test("a rendered time is the viewer's own clock, uppercased", () => {
  withZone("Asia/Kolkata", () => {
    // 06:40 UTC is 12:10 IST — the viewer's clock, not the stored one.
    assert.equal(formatEventTime("2026-09-25T06:40:00.000Z"), "12:10 PM");
  });
  withZone("America/New_York", () => {
    // The same instant is 02:40 EDT for this viewer.
    assert.equal(formatEventTime("2026-09-25T06:40:00.000Z"), "2:40 AM");
  });
});

test("a range joins both ends, and a lone start stands alone", () => {
  withZone("Asia/Kolkata", () => {
    assert.equal(
      formatEventTimeRange("2026-09-25T06:40:00.000Z", "2026-09-25T08:10:00.000Z"),
      "12:10 PM – 1:40 PM",
    );
    assert.equal(formatEventTimeRange("2026-09-25T06:40:00.000Z", null), "12:10 PM");
  });
});

test("an unreadable timestamp renders nothing rather than \"Invalid Date\"", () => {
  assert.equal(formatEventTime("not a date"), "");
  assert.equal(formatEventTimeRange("not a date", "2026-09-25T08:10:00.000Z"), "");
});

test("the zone label is taken from the event's date, not today's", () => {
  withZone("America/New_York", () => {
    // Summer is EDT (UTC-4), winter EST (UTC-5) — the event's own instant
    // decides, so an event after a DST change is labelled correctly.
    assert.equal(eventZoneLabel("2026-07-15T12:00:00.000Z"), "EDT · UTC-4:00");
    assert.equal(eventZoneLabel("2026-01-15T12:00:00.000Z"), "EST · UTC-5:00");
  });
  withZone("Asia/Kolkata", () => {
    // No trustworthy abbreviation for India; the offset alone is the label.
    assert.equal(eventZoneLabel("2026-09-25T06:40:00.000Z"), "UTC+5:30");
  });
});

test("the tooltip names the zone and says the moment is shared", () => {
  withZone("Asia/Kolkata", () => {
    const tip = eventZoneTooltip("2026-09-25T06:40:00.000Z");
    assert.match(tip, /your timezone/);
    assert.match(tip, /UTC\+5:30/);
    assert.match(tip, /same moment for everyone/);
  });
});
