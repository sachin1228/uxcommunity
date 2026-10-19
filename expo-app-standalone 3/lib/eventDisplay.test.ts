import { test } from "node:test";
import assert from "node:assert/strict";
import { formatEventTime, formatEventTimeRange, hostScheduleForViewer } from "./eventDisplay";

/** Runs assertions with the phone's zone frozen, as the timezone suite does. */
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

test("the viewer's own clock reads the instant, 12-hour and uppercase", () =>
  withZone("Asia/Kolkata", () => {
    assert.equal(formatEventTime("2026-08-15T12:30:00Z"), "6:00 PM");
    assert.equal(formatEventTime("2026-08-15T18:30:00Z"), "12:00 AM");
    assert.equal(formatEventTime("not-a-date"), "");
  }));

test("a time range keeps its end only when one is stored", () =>
  withZone("Asia/Kolkata", () => {
    assert.equal(
      formatEventTimeRange("2026-08-15T12:30:00Z", "2026-08-15T14:00:00Z"),
      "6:00 PM – 7:30 PM",
    );
    assert.equal(formatEventTimeRange("2026-08-15T12:30:00Z", null), "6:00 PM");
    assert.equal(formatEventTimeRange("", null), "");
  }));

test("a host in another zone gets their own line", () =>
  withZone("Asia/Kolkata", () => {
    const schedule = hostScheduleForViewer({
      event_date: "2026-08-15T14:30:00Z",
      end_date: "2026-08-15T16:00:00Z",
      host_timezone: "America/New_York",
      host_utc_offset_minutes: -240,
    });
    assert.deepEqual(schedule, {
      range: "10:30 AM – 12:00 PM",
      zone: "EDT · UTC-4:00",
    });
  }));

test("a host on the viewer's clock adds no second line", () =>
  withZone("Asia/Kolkata", () => {
    assert.equal(
      hostScheduleForViewer({
        event_date: "2026-08-15T14:30:00Z",
        host_timezone: "Asia/Kolkata",
        host_utc_offset_minutes: 330,
      }),
      null,
    );
  }));

test("the stored offset stands in when the zone name cannot be resolved", () =>
  withZone("UTC", () => {
    assert.deepEqual(
      hostScheduleForViewer({
        event_date: "2026-08-15T12:00:00Z",
        host_timezone: null,
        host_utc_offset_minutes: 330,
      }),
      { range: "5:30 PM", zone: "UTC+5:30" },
    );
  }));

test("an event that predates the host zone has nothing to add", () =>
  withZone("Asia/Kolkata", () => {
    assert.equal(
      hostScheduleForViewer({ event_date: "2026-08-15T14:30:00Z" }),
      null,
    );
  }));
