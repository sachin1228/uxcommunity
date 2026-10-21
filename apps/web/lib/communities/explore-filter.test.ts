/**
 * Which rows each Explore tab shows.
 *
 * The guarantees: Explore browses public communities only (private rows are
 * never listed, even when the member already asked to join), profile-mirror
 * communities stay unbrowsable, and the requests tab is the member's own
 * outgoing requests rather than discovery.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { EXPLORE_TABS, visibleExploreRows } from "./explore-filter";
import type { CachedExploreCommunity } from "./cache/types";

function row(
  overrides: Partial<CachedExploreCommunity> & { id: string },
): CachedExploreCommunity {
  return {
    name: overrides.id,
    type: "user",
    image_url: null,
    description: null,
    member_count: 5,
    joined: false,
    can_join: true,
    ...overrides,
  };
}

const ids = (rows: CachedExploreCommunity[]) => rows.map((c) => c.id);

test("Explore offers two pills: All and Requests sent", () => {
  assert.deepEqual(
    EXPLORE_TABS.map((tab) => tab.label),
    ["All", "Requests sent"],
  );
});

test("the browse list keeps its order and drops private rows", () => {
  const rows = [
    row({ id: "a", name: "Alpha" }),
    row({ id: "b", name: "Beta", is_private: true }),
    row({ id: "c", name: "Gamma" }),
  ];

  assert.deepEqual(ids(visibleExploreRows(rows, "all", "")), ["a", "c"]);
});

test("a row written before is_private existed reads as public", () => {
  const rows = [row({ id: "unflagged" }), row({ id: "invite-only", is_private: true })];

  assert.deepEqual(ids(visibleExploreRows(rows, "all", "")), ["unflagged"]);
});

test("joined and profile-mirror communities are never browsable", () => {
  const rows = [
    row({ id: "mine", joined: true }),
    row({ id: "my-city", type: "city" }),
    row({ id: "open" }),
  ];

  assert.deepEqual(ids(visibleExploreRows(rows, "all", "")), ["open"]);
});

test("a private community already asked for stays on the requests tab only", () => {
  const rows = [
    row({ id: "asked", is_private: true, has_pending_request: true }),
    row({ id: "unasked", is_private: true }),
  ];

  assert.deepEqual(ids(visibleExploreRows(rows, "all", "")), []);
  assert.deepEqual(ids(visibleExploreRows(rows, "requests", "")), ["asked"]);
});

test("the requests tab is not a discovery slice of the browse tab", () => {
  const rows = [
    // Joined and profile-mirror rules do not apply: it is the member's own
    // record of an outgoing request.
    row({ id: "asked", is_private: true, has_pending_request: true, joined: true }),
    row({ id: "mirror", type: "sector", is_private: true, has_pending_request: true }),
    row({ id: "public-asked", has_pending_request: true }),
    row({ id: "open" }),
  ];

  assert.deepEqual(ids(visibleExploreRows(rows, "requests", "")), [
    "asked",
    "mirror",
    "public-asked",
  ]);
});

test("search is trimmed, case-insensitive, and applies to both tabs", () => {
  const rows = [
    row({ id: "design-systems", name: "Design Systems" }),
    row({ id: "design-private", name: "Design Ops", is_private: true, has_pending_request: true }),
    row({ id: "backend", name: "Backend" }),
  ];

  assert.deepEqual(ids(visibleExploreRows(rows, "all", "  design ")), ["design-systems"]);
  assert.deepEqual(ids(visibleExploreRows(rows, "requests", "DESIGN")), ["design-private"]);
  assert.deepEqual(ids(visibleExploreRows(rows, "all", "nothing here")), []);
});
