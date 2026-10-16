/**
 * Tests for the event date badge — ported from the web app's
 * `lib/communities/event-date.test.ts` so both clients agree on when a room
 * wears its date, its LIVE pill, or its ENDED pill.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EVENT_ENDED_GRACE_MS, eventDateBadge } from './eventDate';

/** A local wall-clock time, ISO-encoded the way the API hands one over. */
function at(year: number, month: number, day: number, hour: number, minute = 0): string {
  return new Date(year, month, day, hour, minute).toISOString();
}

test('an event date becomes an uppercase month over the day', () => {
  const badge = eventDateBadge(at(2026, 8, 25, 16));
  assert.equal(badge?.month, 'SEPT');
  assert.equal(badge?.day, '25');
});

test('the badge names the weekday and year for assistive tech', () => {
  const badge = eventDateBadge(at(2026, 8, 25, 16));
  assert.equal(badge?.label, 'Fri, 25 Sept 2026');
});

test('single-digit days and short months stay short enough for the tile', () => {
  const badge = eventDateBadge(at(2026, 2, 3, 9, 30));
  assert.equal(badge?.month, 'MAR');
  assert.equal(badge?.day, '3');
  assert.equal(badge?.label, 'Tue, 3 Mar 2026');
});

test('a missing or unparseable date renders no badge', () => {
  assert.equal(eventDateBadge(null), null);
  assert.equal(eventDateBadge(undefined), null);
  assert.equal(eventDateBadge(''), null);
  assert.equal(eventDateBadge('not a date'), null);
});

test('a late-evening event keeps its own calendar day', () => {
  assert.equal(eventDateBadge(at(2026, 8, 25, 23, 30))?.day, '25');
});

test('an event on the viewer\'s own day is marked today', () => {
  const badge = eventDateBadge(at(2026, 8, 25, 10, 30), { now: new Date(2026, 8, 25, 8) });
  assert.equal(badge?.isToday, true);
});

test('a late-night event is still today in the viewer\'s zone', () => {
  const badge = eventDateBadge(at(2026, 8, 25, 23, 30), { now: new Date(2026, 8, 25, 0, 5) });
  assert.equal(badge?.isToday, true);
});

test('the day before and the day after are not today', () => {
  const now = new Date(2026, 8, 25, 12);
  assert.equal(eventDateBadge(at(2026, 8, 26, 12), { now })?.isToday, false);
  assert.equal(eventDateBadge(at(2026, 8, 24, 23, 59), { now })?.isToday, false);
});

test('the same calendar day a year ago is not today', () => {
  const now = new Date(2026, 8, 25, 12);
  assert.equal(eventDateBadge(at(2025, 8, 25, 12), { now })?.isToday, false);
});

test('an event with no known end ends immediately', () => {
  const badge = eventDateBadge(at(2026, 8, 25, 10, 30), { now: new Date(2026, 8, 25, 9) });
  assert.equal(badge?.isLive, false);
  assert.equal(badge?.isEnded, false);
  assert.equal(badge?.isToday, true);
  const past = eventDateBadge(at(2026, 8, 25, 10, 30), { now: new Date(2026, 8, 25, 11) });
  assert.equal(past?.isLive, false);
  assert.equal(past?.isEnded, true);
});

test('a long-past event still names its month, without ENDED', () => {
  const badge = eventDateBadge(at(2026, 8, 25, 10, 30), { now: new Date(2026, 8, 27, 12) });
  assert.equal(badge?.month, 'SEPT');
  assert.equal(badge?.isEnded, false);
  assert.equal(badge?.isPast, true);
});

test('an event weeks out keeps its plain date tile', () => {
  const badge = eventDateBadge(at(2026, 9, 2, 18), { now: new Date(2026, 8, 25, 13) });
  assert.equal(badge?.month, 'OCT');
  assert.equal(badge?.day, '2');
  assert.equal(badge?.isToday, false);
  assert.equal(badge?.isLive, false);
  assert.equal(badge?.isEnded, false);
  assert.equal(badge?.isPast, false);
});

test('an event between its start and end is live', () => {
  const badge = eventDateBadge(at(2026, 8, 25, 10, 30), {
    now: new Date(2026, 8, 25, 10, 45),
    endsAt: at(2026, 8, 25, 11, 30),
  });
  assert.equal(badge?.isLive, true);
});

test('live and today are decided separately', () => {
  const later = eventDateBadge(at(2026, 8, 25, 18), {
    now: new Date(2026, 8, 25, 10),
    endsAt: at(2026, 8, 25, 19),
  });
  assert.equal(later?.isToday, true);
  assert.equal(later?.isLive, false);

  const overnight = eventDateBadge(at(2026, 8, 25, 22), {
    now: new Date(2026, 8, 26, 1),
    endsAt: at(2026, 8, 26, 2),
  });
  assert.equal(overnight?.isLive, true);
  assert.equal(overnight?.isToday, false);
});

test('the window is half-open: opens at the start, closes at the end', () => {
  const start = at(2026, 8, 25, 10, 30);
  const end = at(2026, 8, 25, 11, 30);
  assert.equal(eventDateBadge(start, { now: new Date(2026, 8, 25, 10, 30), endsAt: end })?.isLive, true);
  assert.equal(eventDateBadge(start, { now: new Date(2026, 8, 25, 11, 30), endsAt: end })?.isLive, false);
  assert.equal(eventDateBadge(start, { now: new Date(2026, 8, 25, 12), endsAt: end })?.isLive, false);
});

test('an unparseable end never marks the event live or ended', () => {
  const now = new Date(2026, 8, 25, 10, 45);
  const badge = eventDateBadge(at(2026, 8, 25, 10, 30), { now, endsAt: 'not a date' });
  assert.equal(badge?.isLive, false);
  assert.equal(badge?.isEnded, false);
});

test('a just-ended event reads ENDED for half a day, then the badge drops', () => {
  const end = at(2026, 8, 25, 11);
  const start = at(2026, 8, 25, 10);
  const atEnd = eventDateBadge(start, { now: new Date(2026, 8, 25, 11), endsAt: end });
  assert.equal(atEnd?.isLive, false);
  assert.equal(atEnd?.isEnded, true);

  // Within the grace, ENDED outranks the calendar: once the window closes,
  // ENDED is the more useful fact even on the event's own day.
  const laterToday = eventDateBadge(start, { now: new Date(2026, 8, 25, 11, 30), endsAt: end });
  assert.equal(laterToday?.isEnded, true);
  assert.equal(laterToday?.isToday, true);

  const evening = eventDateBadge(start, { now: new Date(2026, 8, 25, 22, 59), endsAt: end });
  assert.equal(evening?.isEnded, true);

  // One millisecond past the grace — not "at" it: the window is half-open too.
  const justAfterGrace = eventDateBadge(start, {
    now: new Date(Date.parse(end) + EVENT_ENDED_GRACE_MS),
    endsAt: end,
  });
  assert.equal(justAfterGrace?.isEnded, false);
});

test('the just-ended badge still names the day it was for', () => {
  const badge = eventDateBadge(at(2026, 8, 25, 10), {
    now: new Date(2026, 8, 25, 11, 30),
    endsAt: at(2026, 8, 25, 11),
  });
  assert.equal(badge?.month, 'SEPT');
  assert.equal(badge?.day, '25');
  assert.equal(badge?.isEnded, true);
});
