import assert from "node:assert/strict";
import test from "node:test";

import { applyEventRealtimeEvent } from "./event-realtime";
import type { CommunityEvent } from "./models/events";

const ME = "me";

function event(overrides: Partial<CommunityEvent> = {}): CommunityEvent {
  return {
    id: "e1",
    community_id: "c1",
    user_id: "author",
    title: "Event",
    description: null,
    event_date: "2026-02-01T10:00:00Z",
    end_date: null,
    is_online: false,
    location: null,
    meet_link: null,
    max_attendees: null,
    cover_image_url: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    rsvp_count: 4,
    user_rsvped: false,
    like_count: 2,
    comment_count: 0,
    user_liked: false,
    save_count: 1,
    user_saved: false,
    users: null,
    ...overrides,
  };
}

test("one like patches the row locally instead of refetching both pages", () => {
  const result = applyEventRealtimeEvent(
    [event(), event({ id: "e2", like_count: 9 })],
    "like",
    { event: "INSERT", event_id: "e1", user_id: "someone-else" },
    ME,
  );

  assert.equal(result.handled, true, "no revalidation requested");
  assert.equal(result.changed, true);
  assert.equal(result.items[0].like_count, 3);
  assert.equal(result.items[1].like_count, 9);
});

test("one RSVP patches attendance without a page fetch", () => {
  const result = applyEventRealtimeEvent(
    [event()],
    "rsvp",
    { event: "DELETE", event_id: "e1", user_id: "someone-else" },
    ME,
  );

  assert.equal(result.handled, true);
  assert.equal(result.items[0].rsvp_count, 3);
});

test("another user's save patches the save count", () => {
  const result = applyEventRealtimeEvent(
    [event()],
    "save",
    { event: "INSERT", event_id: "e1", user_id: "someone-else" },
    ME,
  );

  assert.equal(result.handled, true);
  assert.equal(result.items[0].save_count, 2);
});

test("the actor's own echo does not double-count the POST result", () => {
  for (const topic of ["like", "rsvp", "save"] as const) {
    const result = applyEventRealtimeEvent(
      [event()],
      topic,
      { event: "INSERT", event_id: "e1", user_id: ME },
      ME,
    );
    assert.equal(result.handled, true);
    assert.equal(result.changed, false, `${topic} echo must not move the count`);
  }
});

test("old payloads without a marker and structural events revalidate once", () => {
  const legacy = applyEventRealtimeEvent(
    [event()],
    "like",
    { event_id: "e1", user_id: "someone-else" },
    ME,
  );
  assert.equal(legacy.handled, false);

  const structural = applyEventRealtimeEvent(
    [event()],
    "event",
    { id: "e1", title: "Edited" },
    ME,
  );
  assert.equal(structural.handled, false);
});
