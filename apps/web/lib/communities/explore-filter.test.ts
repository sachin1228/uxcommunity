/**
 * Which rows each Explore tab shows.
 *
 * The guarantees: the privacy pills narrow the same discovery list the All tab
 * shows (never a different set of rules), profile-mirror communities stay
 * unbrowsable on every tab, and the requests tab is the member's own outgoing
 * requests rather than public/private discovery.
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

test("the privacy pills sit between All and the requests tab", () => {
  assert.deepEqual(
    EXPLORE_TABS.map((tab) => tab.label),
    ["All", "Public", "Private", "Requests sent"],
  );
});

test("an alphabetical list keeps its order on every tab", () => {
  const rows = [
    row({ id: "a", name: "Alpha" }),
    row({ id: "b", name: "Beta", is_private: true }),
    row({ id: "c", name: "Gamma" }),
  ];

  assert.deepEqual(ids(visibleExploreRows(rows, "all", "")), ["a", "b", "c"]);
  assert.deepEqual(ids(visibleExploreRows(rows, "public", "")), ["a", "c"]);
  assert.deepEqual(ids(visibleExploreRows(rows, "private", "")), ["b"]);
});

test("the Public tab takes the private rows out, not the other way round", () => {
  const rows = [
    row({ id: "open", is_private: false }),
    // `is_private` absent is public, same as the name badges read it.
    row({ id: "unflagged" }),
    row({ id: "invite-only", is_private: true }),
  ];

  assert.deepEqual(ids(visibleExploreRows(rows, "public", "")), ["open", "unflagged"]);
  assert.deepEqual(ids(visibleExploreRows(rows, "private", "")), ["invite-only"]);
});

test("privacy pills narrow the same discovery list All shows", () => {
  const rows = [
    row({ id: "mine", joined: true }),
    row({ id: "my-city", type: "city" }),
    row({ id: "open" }),
  ];

  // Nothing joined and no profile-mirror row under either privacy tab.
  assert.deepEqual(ids(visibleExploreRows(rows, "public", "")), ["open"]);
  assert.deepEqual(ids(visibleExploreRows(rows, "private", "")), []);
});

test("a private community already asked for stays listed with its request", () => {
  const rows = [
    row({ id: "asked", is_private: true, has_pending_request: true }),
    row({ id: "unasked", is_private: true }),
  ];

  assert.deepEqual(ids(visibleExploreRows(rows, "private", "")), ["asked", "unasked"]);
  assert.deepEqual(ids(visibleExploreRows(rows, "requests", "")), ["asked"]);
});

test("the requests tab is not a discovery slice of the other tabs", () => {
  const rows = [
    // Joined and profile-mirror rules do not apply: a request can only exist on
    // a private community, and it is the member's own record either way.
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

test("search is trimmed, case-insensitive, and applies to every tab", () => {
  const rows = [
    row({ id: "design-systems", name: "Design Systems" }),
    row({ id: "design-private", name: "Design Ops", is_private: true, has_pending_request: true }),
    row({ id: "backend", name: "Backend" }),
  ];

  assert.deepEqual(ids(visibleExploreRows(rows, "all", "  design ")), [
    "design-systems",
    "design-private",
  ]);
  assert.deepEqual(ids(visibleExploreRows(rows, "public", "design")), ["design-systems"]);
  assert.deepEqual(ids(visibleExploreRows(rows, "private", "DESIGN")), ["design-private"]);
  assert.deepEqual(ids(visibleExploreRows(rows, "requests", "design")), ["design-private"]);
  assert.deepEqual(ids(visibleExploreRows(rows, "all", "nothing here")), []);
});
