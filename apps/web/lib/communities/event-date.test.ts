import { test } from "node:test";
import assert from "node:assert/strict";
import { eventDateBadge } from "./event-date";

/** A local wall-clock time, ISO-encoded the way the API hands one over. */
function at(year: number, month: number, day: number, hour: number, minute = 0): string {
  return new Date(year, month, day, hour, minute).toISOString();
}

test("an event date becomes an uppercase month over the day", () => {
  const badge = eventDateBadge(at(2026, 8, 25, 16));
  assert.equal(badge?.month, "SEPT");
  assert.equal(badge?.day, "25");
});

test("the badge names the weekday and year for hover and assistive tech", () => {
  const badge = eventDateBadge(at(2026, 8, 25, 16));
  assert.equal(badge?.label, "Fri, 25 Sept 2026");
});

test("single-digit days and short months stay short enough for the circle", () => {
  const badge = eventDateBadge(at(2026, 2, 3, 9, 30));
  assert.equal(badge?.month, "MAR");
  assert.equal(badge?.day, "3");
  assert.equal(badge?.label, "Tue, 3 Mar 2026");
});

test("a missing or unparseable date renders no badge", () => {
  assert.equal(eventDateBadge(null), null);
  assert.equal(eventDateBadge(undefined), null);
  assert.equal(eventDateBadge(""), null);
  assert.equal(eventDateBadge("not a date"), null);
});

test("a late-evening event keeps its own calendar day", () => {
  // The badge formats in the viewer's zone, so an ISO stamp round trip must
  // not slide a 23:30 event onto the following day.
  assert.equal(eventDateBadge(at(2026, 8, 25, 23, 30))?.day, "25");
});

test("an event on the viewer's own day is marked today", () => {
  const badge = eventDateBadge(at(2026, 8, 25, 10, 30), { now: new Date(2026, 8, 25, 8) });
  assert.equal(badge?.isToday, true);
});

test("a late-night event is still today in the viewer's zone", () => {
  const badge = eventDateBadge(at(2026, 8, 25, 23, 30), { now: new Date(2026, 8, 25, 0, 5) });
  assert.equal(badge?.isToday, true);
});

test("the day before and the day after are not today", () => {
  const now = new Date(2026, 8, 25, 12);
  assert.equal(eventDateBadge(at(2026, 8, 26, 12), { now })?.isToday, false);
  assert.equal(eventDateBadge(at(2026, 8, 24, 23, 59), { now })?.isToday, false);
});

test("the same calendar day a year ago is not today", () => {
  // Guards against a today check that compares month-and-day and ignores the year.
  const now = new Date(2026, 8, 25, 12);
  assert.equal(eventDateBadge(at(2025, 8, 25, 12), { now })?.isToday, false);
});

test("the clock defaults to now rather than requiring one", () => {
  const badge = eventDateBadge(at(2026, 8, 25, 10, 30));
  assert.equal(typeof badge?.isToday, "boolean");
  assert.equal(typeof badge?.isLive, "boolean");
});

// ─── The live window: [start, end) ───────────────────────────────────────────

test("an event between its start and end is live", () => {
  const badge = eventDateBadge(at(2026, 8, 25, 10, 30), {
    now: new Date(2026, 8, 25, 10, 45),
    endsAt: at(2026, 8, 25, 11, 30),
  });
  assert.equal(badge?.isLive, true);
});

test("live and today are decided separately", () => {
  // Starts later today: today's room, not one that is happening.
  const later = eventDateBadge(at(2026, 8, 25, 18), {
    now: new Date(2026, 8, 25, 10),
    endsAt: at(2026, 8, 25, 19),
  });
  assert.equal(later?.isToday, true);
  assert.equal(later?.isLive, false);

  // Runs across midnight: happening, but on neither viewer's day.
  const overnight = eventDateBadge(at(2026, 8, 25, 22), {
    now: new Date(2026, 8, 26, 1),
    endsAt: at(2026, 8, 26, 2),
  });
  assert.equal(overnight?.isLive, true);
  assert.equal(overnight?.isToday, false);
});

test("the window is half-open, so it opens at the start and closes at the end", () => {
  const start = at(2026, 8, 25, 10, 30);
  const end = at(2026, 8, 25, 11, 30);
  assert.equal(eventDateBadge(start, { now: new Date(2026, 8, 25, 10, 30), endsAt: end })?.isLive, true);
  assert.equal(eventDateBadge(start, { now: new Date(2026, 8, 25, 11, 30), endsAt: end })?.isLive, false);
  assert.equal(eventDateBadge(start, { now: new Date(2026, 8, 25, 12), endsAt: end })?.isLive, false);
});

test("an event with no known end is never announced as live", () => {
  // The sidebar's pin deadline is the event's end, or its start when it has
  // none — so a window nobody recorded reads as closed, not as endlessly on.
  const now = new Date(2026, 8, 25, 10, 45);
  assert.equal(eventDateBadge(at(2026, 8, 25, 10, 30), { now, endsAt: null })?.isLive, false);
  assert.equal(eventDateBadge(at(2026, 8, 25, 10, 30), { now })?.isLive, false);
  assert.equal(
    eventDateBadge(at(2026, 8, 25, 10, 30), { now, endsAt: "not a date" })?.isLive,
    false,
  );
});
