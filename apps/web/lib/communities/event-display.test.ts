import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatEventTime,
  formatEventTimeRange,
  eventZoneLabel,
  eventZoneTooltip,
  hostScheduleForViewer,
} from "./event-display";
import { zoneOffsetMinutes } from "./timezone";

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

// ─── The host's side ────────────────────────────────────────────────────────

/** An event an American host set for 3:00 – 5:00 PM their time. */
const NEW_YORK_EVENT = {
  event_date: "2026-07-15T19:00:00.000Z", // 3:00 PM EDT
  end_date: "2026-07-15T21:00:00.000Z", // 5:00 PM EDT
  host_timezone: "America/New_York",
  host_utc_offset_minutes: -240,
};

test("an Indian viewer sees the host's own 3 PM beside their reading", () => {
  withZone("Asia/Kolkata", () => {
    assert.deepEqual(hostScheduleForViewer(NEW_YORK_EVENT), {
      range: "3:00 PM – 5:00 PM",
      zone: "EDT · UTC-4:00",
    });
  });
});

test("a viewer in the host's zone gets no second line at all", () => {
  withZone("America/New_York", () => {
    // The stored offset equals this viewer's for that instant, so the host's
    // time is already the time on the card.
    assert.equal(hostScheduleForViewer(NEW_YORK_EVENT), null);
  });
});

test("an event without a recorded host zone stays silent", () => {
  withZone("Asia/Kolkata", () => {
    // Every event created before the columns existed looks like this.
    assert.equal(
      hostScheduleForViewer({ event_date: NEW_YORK_EVENT.event_date, end_date: NEW_YORK_EVENT.end_date }),
      null,
    );
    assert.equal(
      hostScheduleForViewer({
        event_date: NEW_YORK_EVENT.event_date,
        host_timezone: null,
        host_utc_offset_minutes: null,
      }),
      null,
    );
  });
});

test("the stored offset carries the host's time when the zone name means nothing", () => {
  withZone("Asia/Kolkata", () => {
    assert.deepEqual(
      hostScheduleForViewer({
        ...NEW_YORK_EVENT,
        host_timezone: "Mars/Olympus", // unresolvable on this runtime
      }),
      { range: "3:00 PM – 5:00 PM", zone: "UTC-4:00" },
    );
    // An unusable name with no offset leaves nothing to show.
    assert.equal(
      hostScheduleForViewer({
        event_date: NEW_YORK_EVENT.event_date,
        host_timezone: "Mars/Olympus",
        host_utc_offset_minutes: null,
      }),
      null,
    );
  });
});

test("a host open-ended event shows only the start time", () => {
  withZone("Asia/Kolkata", () => {
    assert.deepEqual(
      hostScheduleForViewer({ ...NEW_YORK_EVENT, end_date: null }),
      { range: "3:00 PM", zone: "EDT · UTC-4:00" },
    );
  });
});

test("the host's label follows their own date across a DST change", () => {
  withZone("Asia/Kolkata", () => {
    // Same host, an event in January: EST at UTC-5, not the summer's UTC-4.
    assert.deepEqual(
      hostScheduleForViewer({
        event_date: "2026-01-15T20:00:00.000Z",
        end_date: null,
        host_timezone: "America/New_York",
        host_utc_offset_minutes: -300,
      }),
      { range: "3:00 PM", zone: "EST · UTC-5:00" },
    );
  });
});

test("an unreadable instant drops the host line rather than rendering nonsense", () => {
  withZone("Asia/Kolkata", () => {
    assert.equal(hostScheduleForViewer({ ...NEW_YORK_EVENT, event_date: "not a date" }), null);
  });
});

test("zoneOffsetMinutes reads a named zone at an instant in minutes east", () => {
  const july = new Date("2026-07-15T12:00:00Z");
  assert.equal(zoneOffsetMinutes("Asia/Kolkata", july), 330);
  assert.equal(zoneOffsetMinutes("America/New_York", july), -240);
  assert.equal(zoneOffsetMinutes("UTC", july), 0);
  assert.equal(zoneOffsetMinutes("Mars/Olympus", july), null);
});
