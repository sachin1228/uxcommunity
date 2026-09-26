import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventRsvp } from "@/lib/communities/models/events";
import { goingPreview, toGoingEntries } from "./going-list";

const ME = "user-me";

function rsvp(userId: string, name: string | null, avatar: string | null = null): EventRsvp {
  return {
    event_id: "event-1",
    user_id: userId,
    created_at: "2026-09-24T12:00:00Z",
    users: name ? { name, avatar_url: avatar } : null,
  };
}

function many(count: number): EventRsvp[] {
  return Array.from({ length: count }, (_, index) =>
    rsvp(`user-${index}`, `member ${index}`),
  );
}

test("the reader sees themselves as You, everyone else by name", () => {
  const entries = toGoingEntries(
    [rsvp("user-1", "john doe"), rsvp(ME, "sachin patil")],
    ME,
  );

  assert.deepEqual(
    entries.map((entry) => [entry.label, entry.is_self]),
    [
      ["john doe", false],
      ["You", true],
    ],
  );
  // The row still identifies the member, and keeps their real name: the avatar
  // falls back to initials and a colour, which must not become "Y".
  assert.equal(entries[1]?.user_id, ME);
  assert.equal(entries[1]?.name, "sachin patil");
});

test("a member with no profile still appears in the list", () => {
  const entries = toGoingEntries([rsvp("user-2", null)], ME);
  assert.equal(entries[0]?.label, "Someone");
  assert.equal(entries[0]?.avatar_url, null);
});

test("the remainder is counted from the total, not from the rows in hand", () => {
  // A full event: the payload carries a bounded preview (24 rows), the card
  // shows 6, and 94 people are still going. Counting from the slice alone
  // would claim "+18 more".
  const { visible, more } = goingPreview(toGoingEntries(many(24), ME), 6, 100);

  assert.equal(visible.length, 6);
  assert.equal(more, 94);
});

test("a list that fits has nothing left over", () => {
  const entries = toGoingEntries(many(6), ME);
  assert.equal(goingPreview(entries, 6).more, 0, "nothing beyond the six shown");
  assert.equal(goingPreview(entries, 6, 6).more, 0);
  assert.equal(goingPreview([], 6).more, 0);
  assert.equal(goingPreview([], 6, 0).more, 0);
});

test("a short list survives the cut untouched, in RSVP order", () => {
  const entries = toGoingEntries([rsvp("user-1", "first"), rsvp("user-2", "second")], ME);
  const { visible, more } = goingPreview(entries, 6);

  assert.deepEqual(visible.map((entry) => entry.label), ["first", "second"]);
  assert.equal(more, 0);
});

test("a total below the rows shown never produces a negative count", () => {
  // Defensive: a stale rsvp_count must not render "+-2 more going".
  const entries = toGoingEntries(many(5), ME);
  assert.equal(goingPreview(entries, 6, 3).more, 0);
});
