import assert from "node:assert/strict";
import { test } from "node:test";
import { compareByRecentActivity, isPinned } from "./sidebar-order";

/** The exact shape the comparator takes — no restating of fields. */
type Ordered = Parameters<typeof compareByRecentActivity>[0];

/**
 * A sidebar row with only the fields the ordering reads. `joined` doubles as
 * the activity anchor for a brand-new room that has no messages yet, which is
 * exactly how an event's chat enters the list.
 */
function community(
  name: string,
  lastMessageAt: string | null,
  overrides: Partial<Ordered> = {},
): Ordered {
  return {
    name,
    joined_at: lastMessageAt,
    pinned_until: null,
    last_content: null,
    last_message: lastMessageAt
      ? {
          id: `${name}-msg`,
          content: `msg-${lastMessageAt}`,
          created_at: lastMessageAt,
          user: { name: "john" },
        }
      : null,
    ...overrides,
  };
}

function order(communities: Ordered[]): string[] {
  return [...communities].sort(compareByRecentActivity).map((c) => c.name);
}

// The exact situation the pin exists for: an event goes out, the room is empty,
// and the busy communities it has to outrank all have fresh messages.
const BUSY: Ordered[] = [
  community("General", "2026-09-24T18:20:00Z"),
  community("Bangalore Designers", "2026-09-24T17:05:00Z"),
  community("Product Design", "2026-09-24T16:44:00Z"),
];

test("an event chat sits above every community with newer messages", () => {
  const eventRoom = community("Designup decade", "2026-09-24T12:00:00Z", {
    pinned_until: "2026-10-03T18:30:00Z",
  });
  assert.deepEqual(order([...BUSY, eventRoom])[0], "Designup decade");
});

test("a room that is not pinned sorts back down with the rest", () => {
  // Same room, same (older) activity, pin gone: the flag is the only reason it
  // was ever above communities that talk more.
  const expired = community("Designup decade", "2026-09-24T12:00:00Z");
  assert.deepEqual(order([...BUSY, expired]), [
    "General",
    "Bangalore Designers",
    "Product Design",
    "Designup decade",
  ]);
});

test("isPinned only reads the flag, so an expired pin is not a pin", () => {
  assert.equal(isPinned(community("A", null, { pinned_until: "2026-10-03T18:30:00Z" })), true);
  assert.equal(isPinned(community("A", null, { pinned_until: null })), false);
  assert.equal(isPinned(community("A", null)), false);
});

test("the event somebody just RSVPed to is at the very top of the pinned group", () => {
  // Two pinned event rooms: the one joined most recently leads, so a fresh
  // RSVP (or the event you just created) lands at the first position — a room
  // an hour older is still up there, just below it.
  const conference = community("Designup decade", null, {
    joined_at: "2026-09-24T12:00:00Z",
    pinned_until: "2026-10-03T18:30:00Z",
  });
  const townHall = community("Bangalore meetup", null, {
    joined_at: "2026-09-24T16:30:00Z",
    pinned_until: "2026-09-27T11:00:00Z",
  });

  assert.deepEqual(order([conference, ...BUSY, townHall]), [
    "Bangalore meetup",
    "Designup decade",
    "General",
    "Bangalore Designers",
    "Product Design",
  ]);
  assert.equal(compareByRecentActivity(townHall, conference) < 0, true);
});

test("pinned rooms keep outranking unflagged ones whatever their dates", () => {
  // A pinned room with an imminent deadline still beats a busier community;
  // the deadline is display information, not a tiebreaker against messages.
  const upcoming = community("Designup decade", null, {
    joined_at: "2026-09-01T09:00:00Z",
    pinned_until: "2026-09-25T09:00:00Z",
  });
  assert.equal(order([...BUSY, upcoming])[0], "Designup decade");
});

test("a brand-new thread still raises a community the way a message does", () => {
  // Guard on the ordering the pin was folded into: content (and the join date
  // for a room with nothing in it yet) counts as activity.
  const withThread = community("Illustration", "2026-09-24T16:00:00Z", {
    last_content: {
      id: "t1",
      kind: "thread",
      title: "Design systems",
      created_at: "2026-09-24T18:30:00Z",
      firstName: "john",
    },
  });
  assert.deepEqual(order([...BUSY, withThread])[0], "Illustration");
});

test("ties fall back to the name so the order never wobbles", () => {
  const a = community("Zebra", "2026-09-24T10:00:00Z");
  const b = community("Aardvark", "2026-09-24T10:00:00Z");
  assert.deepEqual(order([a, b]), ["Aardvark", "Zebra"]);
  assert.deepEqual(order([b, a]), ["Aardvark", "Zebra"]);
});
