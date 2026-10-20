import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dueStages,
  eventStartLabel,
  lifecycleHref,
  lifecycleNotice,
  type LifecycleEvent,
} from "./lifecycle";

/** 8:45 PM IST on 21 Oct 2026, created two days earlier. */
function event(overrides: Partial<LifecycleEvent> = {}): LifecycleEvent {
  return {
    id: "evt-1",
    title: "Figma config winter event",
    event_date: "2026-10-21T15:15:00Z",
    end_date: "2026-10-21T17:15:00Z",
    created_at: "2026-10-19T00:00:00Z",
    host_timezone: "Asia/Kolkata",
    host_utc_offset_minutes: 330,
    community_id: "community-1",
    ...overrides,
  };
}

const at = (iso: string) => new Date(iso);

test("tomorrow lands at T-24h and keeps the time it was created", () => {
  assert.deepEqual(dueStages(event(), at("2026-10-20T15:15:00Z")), ["tomorrow"]);
  assert.deepEqual(dueStages(event(), at("2026-10-20T15:29:00Z")), ["tomorrow"]);
  assert.deepEqual(dueStages(event(), at("2026-10-20T15:31:00Z")), []);
});

test("tomorrow is skipped for an event created inside the last day", () => {
  // Created 21 hours before the start: the T-24h slot had already passed, so
  // the next moments carry it rather than a late, wrong "tomorrow".
  const late = event({ created_at: "2026-10-20T18:00:00Z" });
  assert.deepEqual(dueStages(late, at("2026-10-20T18:10:00Z")), []);
});

test("today fires at 09:00 in the event's own zone", () => {
  // 09:00 IST is 03:30 UTC.
  assert.deepEqual(dueStages(event(), at("2026-10-21T03:30:00Z")), ["today"]);
  assert.deepEqual(dueStages(event(), at("2026-10-21T03:29:00Z")), []);
  // Still deliverable through the day until two hours before the start…
  assert.deepEqual(dueStages(event(), at("2026-10-21T12:00:00Z")), ["today"]);
  // …then the half-hour call takes over.
  assert.deepEqual(dueStages(event(), at("2026-10-21T14:45:00Z")), ["soon"]);
});

test("today is skipped when the start leaves no morning runway", () => {
  // 06:00 IST — 09:00 lands after the event has already started.
  const early = event({ event_date: "2026-10-22T00:30:00Z", end_date: null });
  assert.deepEqual(dueStages(early, at("2026-10-22T03:30:00Z")), []);
  // 11:00 IST — exactly two hours after the morning slot is still fine.
  const midMorning = event({ event_date: "2026-10-21T05:30:00Z" });
  assert.deepEqual(dueStages(midMorning, at("2026-10-21T03:30:00Z")), ["today"]);
});

test("soon is the half-hour call, and only for events known by then", () => {
  assert.deepEqual(dueStages(event(), at("2026-10-21T14:45:00Z")), ["soon"]);
  assert.deepEqual(dueStages(event(), at("2026-10-21T14:44:00Z")), []);
  assert.deepEqual(dueStages(event(), at("2026-10-21T15:15:00Z")), ["live"]);

  const lateRsvpWindow = event({ created_at: "2026-10-21T15:00:00Z" });
  assert.deepEqual(dueStages(lateRsvpWindow, at("2026-10-21T15:05:00Z")), []);
  assert.deepEqual(dueStages(lateRsvpWindow, at("2026-10-21T15:15:00Z")), ["live"]);
});

test("live and ended follow the event's window", () => {
  assert.deepEqual(dueStages(event(), at("2026-10-21T15:15:00Z")), ["live"]);
  assert.deepEqual(dueStages(event(), at("2026-10-21T15:29:00Z")), ["live"]);
  assert.deepEqual(dueStages(event(), at("2026-10-21T15:30:00Z")), []);
  assert.deepEqual(dueStages(event(), at("2026-10-21T16:00:00Z")), []);
  assert.deepEqual(dueStages(event(), at("2026-10-21T17:15:00Z")), ["ended"]);
  assert.deepEqual(dueStages(event(), at("2026-10-21T17:29:00Z")), ["ended"]);
  assert.deepEqual(dueStages(event(), at("2026-10-21T17:30:00Z")), []);
});

test("an event with no end gets live, never a made-up ended", () => {
  const openEnded = event({ end_date: null });
  assert.deepEqual(dueStages(openEnded, at("2026-10-21T15:15:00Z")), ["live"]);
  assert.deepEqual(dueStages(openEnded, at("2026-10-21T15:29:00Z")), ["live"]);
  assert.deepEqual(dueStages(openEnded, at("2026-10-21T17:15:00Z")), []);
});

test("unparseable dates produce no stages", () => {
  assert.deepEqual(dueStages(event({ event_date: "not a date" }), at("2026-10-21T15:15:00Z")), []);
});

test("the start clock is said in the event's own zone", () => {
  assert.equal(eventStartLabel(event()), "8:45 PM UTC+5:30");
  const newYork = event({
    event_date: "2026-10-21T19:15:00Z",
    host_timezone: "America/New_York",
    host_utc_offset_minutes: -240,
  });
  assert.equal(eventStartLabel(newYork), "3:15 PM EDT");
});

test("copy and type per stage", () => {
  assert.deepEqual(lifecycleNotice(event(), "tomorrow", { hasRoom: true }), {
    type: "event_reminder",
    title: "Tomorrow: Figma config winter event",
    body: "Starts 8:45 PM UTC+5:30.",
  });
  assert.equal(
    lifecycleNotice(event(), "soon", { hasRoom: true, now: at("2026-10-21T14:45:00Z") }).title,
    "Figma config winter event starts in 30 minutes",
  );
  // A late catch-up run does not claim thirty minutes that are already gone.
  assert.equal(
    lifecycleNotice(event(), "soon", { hasRoom: true, now: at("2026-10-21T15:05:00Z") }).title,
    "Figma config winter event starts soon",
  );
  assert.deepEqual(lifecycleNotice(event(), "live", { hasRoom: true }), {
    type: "event_live",
    title: "Figma config winter event is live now",
    body: "The room is open — join now.",
  });
  assert.deepEqual(lifecycleNotice(event(), "ended", { hasRoom: false }), {
    type: "event_ended",
    title: "Figma config winter event has ended",
    body: "That's a wrap — see you at the next one.",
  });
});

test("href is community-scoped when the event has an owner, city-scoped otherwise", () => {
  assert.equal(
    lifecycleHref(event()),
    "/dashboard/communities/community-1/events/evt-1",
  );
  assert.equal(lifecycleHref(event({ community_id: null })), "/dashboard/events/evt-1");
});
