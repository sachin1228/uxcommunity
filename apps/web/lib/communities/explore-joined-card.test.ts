import assert from "node:assert/strict";
import test from "node:test";

import type { CachedExploreCommunity } from "./cache";
import { isExploreVisible } from "./explore-list";

function community(
  overrides: Partial<CachedExploreCommunity> = {},
): CachedExploreCommunity {
  return {
    id: "community-1",
    name: "Game Design",
    type: "interest",
    image_url: null,
    description: null,
    member_count: 1,
    joined: false,
    can_join: true,
    ...overrides,
  };
}

const NOBODY = new Set<string>();

test("an already-joined community stays out of Explore", () => {
  assert.equal(isExploreVisible(community({ joined: true }), "all", "", NOBODY), false);
});

test("a community joined during this visit keeps its card", () => {
  const gameDesign = community({ id: "community-9", joined: true });

  assert.equal(
    isExploreVisible(gameDesign, "all", "", new Set(["community-9"])),
    true,
    "the card the member just clicked must not vanish",
  );
});

test("the just-joined exemption does not leak to other communities", () => {
  const justJoined = new Set(["community-9"]);

  assert.equal(isExploreVisible(community({ id: "community-9", joined: true }), "all", "", justJoined), true);
  assert.equal(isExploreVisible(community({ id: "community-10", joined: true }), "all", "", justJoined), false);
});

test("a just-joined card still obeys the tab and the search box", () => {
  const justJoined = new Set(["community-9"]);
  const memberLed = community({ id: "community-9", type: "user", joined: true });

  assert.equal(isExploreVisible(memberLed, "user", "", justJoined), true);
  assert.equal(isExploreVisible(memberLed, "interest", "", justJoined), false);
  assert.equal(isExploreVisible(memberLed, "all", "yyy", justJoined), false);
  assert.equal(isExploreVisible(memberLed, "all", "game", justJoined), true);
});

test("a join request that is not a membership needs no exemption", () => {
  // Private community: the card shows "Request sent" and was never joined.
  const pending = community({ is_private: true, joined: false, has_pending_request: true });

  assert.equal(isExploreVisible(pending, "all", "", NOBODY), true);
});

test("master-data communities stay hidden even when just joined", () => {
  for (const type of ["sector", "city", "experience_level", "job_title"] as const) {
    assert.equal(
      isExploreVisible(community({ id: "community-9", type, joined: true }), "all", "", new Set(["community-9"])),
      false,
      `${type} communities are never browsable in Explore`,
    );
  }
});

test("the search box is trimmed and case-insensitive", () => {
  const card = community({ name: "Industrial Design" });

  assert.equal(isExploreVisible(card, "all", "  industrial ", NOBODY), true);
  assert.equal(isExploreVisible(card, "all", "typography", NOBODY), false);
});
