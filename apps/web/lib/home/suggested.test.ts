import assert from "node:assert/strict";
import { test } from "node:test";
import {
  pickSuggestedCommunities,
  type SuggestedCommunitySource,
} from "./suggested";

function community(
  overrides: Partial<SuggestedCommunitySource> & { id: string },
): SuggestedCommunitySource {
  return {
    name: overrides.id,
    type: "interest",
    image_url: null,
    description: null,
    is_private: false,
    member_count: 10,
    joined: false,
    can_join: true,
    ...overrides,
  };
}

test("suggests the biggest open communities the member can join", () => {
  const suggested = pickSuggestedCommunities([
    community({ id: "small", name: "Small", member_count: 12 }),
    community({ id: "big", name: "Big", member_count: 900 }),
    community({ id: "mid", name: "Mid", member_count: 400 }),
  ]);

  assert.deepEqual(
    suggested.map((item) => item.id),
    ["big", "mid", "small"],
  );
});

test("never suggests a community the member is already in", () => {
  const suggested = pickSuggestedCommunities([
    community({ id: "mine", joined: true, member_count: 5000 }),
    community({ id: "open", member_count: 20 }),
  ]);

  assert.deepEqual(
    suggested.map((item) => item.id),
    ["open"],
  );
});

test("skips communities this member's profile cannot join", () => {
  const suggested = pickSuggestedCommunities([
    community({ id: "locked", can_join: false, member_count: 900 }),
    community({ id: "open", member_count: 20 }),
  ]);

  assert.deepEqual(
    suggested.map((item) => item.id),
    ["open"],
  );
});

test("skips private communities — a Join tap there would only file a request", () => {
  const suggested = pickSuggestedCommunities([
    community({ id: "invite-only", is_private: true, member_count: 900 }),
    community({ id: "open", member_count: 20 }),
  ]);

  assert.deepEqual(
    suggested.map((item) => item.id),
    ["open"],
  );
});

test("suggests interest and member-led communities only", () => {
  const suggested = pickSuggestedCommunities([
    community({ id: "auto-joined-at-signup", type: "general", member_count: 9000 }),
    community({ id: "profile-city", type: "city", member_count: 8000 }),
    community({ id: "always-matches", type: "interest", member_count: 30 }),
    community({ id: "member-led", type: "user", member_count: 20 }),
  ]);

  assert.deepEqual(
    suggested.map((item) => item.id),
    ["always-matches", "member-led"],
  );
});

test("breaks member-count ties by name so the order is stable", () => {
  const suggested = pickSuggestedCommunities([
    community({ id: "b", name: "Zebra", member_count: 10 }),
    community({ id: "a", name: "Aardvark", member_count: 10 }),
  ]);

  assert.deepEqual(
    suggested.map((item) => item.name),
    ["Aardvark", "Zebra"],
  );
});

test("honours the limit and returns the card's fields only", () => {
  const suggested = pickSuggestedCommunities(
    [
      community({ id: "one", member_count: 30 }),
      community({ id: "two", member_count: 20 }),
      community({ id: "three", member_count: 10 }),
    ],
    2,
  );

  assert.equal(suggested.length, 2);
  assert.deepEqual(Object.keys(suggested[0]).sort(), [
    "description",
    "id",
    "image_url",
    "member_count",
    "name",
  ]);
});

test("returns nothing when there is nothing eligible", () => {
  assert.deepEqual(pickSuggestedCommunities([]), []);
  assert.deepEqual(
    pickSuggestedCommunities([community({ id: "mine", joined: true })]),
    [],
  );
});
