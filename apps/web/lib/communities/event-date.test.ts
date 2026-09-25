import { test } from "node:test";
import assert from "node:assert/strict";
import { eventDateBadge, hasEventEnded } from "./event-date";

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

test("an event with no known end ends immediately", () => {
  // The sidebar's pin deadline is the event's end, or its start when it has
  // none — a window nobody recorded closes the moment it opens rather than
  // running all day. Before its start: today's room, not live, not ended.
  const badge = eventDateBadge(at(2026, 8, 25, 10, 30), { now: new Date(2026, 8, 25, 9) });
  assert.equal(badge?.isLive, false);
  assert.equal(badge?.isEnded, false);
  assert.equal(badge?.isToday, true);
  // From its start on, it reads as over.
  const past = eventDateBadge(at(2026, 8, 25, 10, 30), { now: new Date(2026, 8, 25, 11) });
  assert.equal(past?.isLive, false);
  assert.equal(past?.isEnded, true);
});

test("a room whose event just wrapped reads ENDED, not TODAY", () => {
  // The lifecycle beats the calendar: a wrapped window outranks its own day.
  const badge = eventDateBadge(at(2026, 8, 25, 12, 10), {
    now: new Date(2026, 8, 25, 13, 15),
    endsAt: at(2026, 8, 25, 13, 10),
  });
  assert.equal(badge?.isEnded, true);
  assert.equal(badge?.isToday, true);
});

test("a long-past event still names its month, without ENDED", () => {
  const badge = eventDateBadge(at(2026, 8, 25, 10, 30), { now: new Date(2026, 8, 27, 12) });
  assert.equal(badge?.month, "SEPT");
  assert.equal(badge?.isEnded, false);
});

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

test("an unparseable end never marks the event live or ended", () => {
  const now = new Date(2026, 8, 25, 10, 45);
  const badge = eventDateBadge(at(2026, 8, 25, 10, 30), { now, endsAt: "not a date" });
  assert.equal(badge?.isLive, false);
  assert.equal(badge?.isEnded, false);
});

// ─── The day after: ENDED, then the tile comes down ──────────────────────────

test("a just-ended event reads ENDED for a day, then the badge drops", () => {
  const end = at(2026, 8, 25, 11);
  const start = at(2026, 8, 25, 10);
  const atEnd = eventDateBadge(start, { now: new Date(2026, 8, 25, 11), endsAt: end });
  assert.equal(atEnd?.isLive, false);
  assert.equal(atEnd?.isEnded, true);

  // Late on the event's own day, the lifecycle has already moved past TODAY:
  // once the window closes, ENDED is the more useful fact even before midnight.
  const laterToday = eventDateBadge(start, { now: new Date(2026, 8, 25, 23), endsAt: end });
  assert.equal(laterToday?.isEnded, true);
  assert.equal(laterToday?.isToday, true);

  const nextDay = eventDateBadge(start, { now: new Date(2026, 8, 26, 9), endsAt: end });
  assert.equal(nextDay?.isEnded, true);
  assert.equal(nextDay?.isToday, false);

  const nextMorning = eventDateBadge(start, { now: new Date(2026, 8, 26, 10, 59), endsAt: end });
  assert.equal(nextMorning?.isEnded, true);

  // One minute past the day: the tile has served its purpose.
  const after = eventDateBadge(start, { now: new Date(2026, 8, 26, 11, 1), endsAt: end });
  assert.equal(after?.isEnded, false);
});

test("the just-ended tile still names the day it was for", () => {
  const badge = eventDateBadge(at(2026, 8, 25, 10), {
    now: new Date(2026, 8, 25, 12),
    endsAt: at(2026, 8, 25, 11),
  });
  assert.equal(badge?.month, "SEPT");
  assert.equal(badge?.day, "25");
  assert.equal(badge?.isEnded, true);
});

test("hasEventEnded reads the same deadline the badge does", () => {
  const start = at(2026, 8, 25, 10);
  assert.equal(hasEventEnded(start, at(2026, 8, 25, 11), new Date(2026, 8, 25, 10, 59)), false);
  assert.equal(hasEventEnded(start, at(2026, 8, 25, 11), new Date(2026, 8, 25, 11)), true);
  // No recorded end: the window closes when it opens.
  assert.equal(hasEventEnded(start, null, new Date(2026, 8, 25, 9)), false);
  assert.equal(hasEventEnded(start, null, new Date(2026, 8, 25, 10)), true);
  // No usable date: nothing to be over.
  assert.equal(hasEventEnded(null, at(2026, 8, 25, 11), new Date(2026, 8, 26)), false);
  assert.equal(hasEventEnded("not a date", null, new Date(2026, 8, 26)), false);
});
