import assert from "node:assert/strict";
import { test } from "node:test";
import type { CachedExploreCommunity } from "@/lib/communities/cache";
import { communityMetaLine, communityTag, memberCountLabel } from "./community-label";
import { matchesCommunitySearch, selectSuggestedCommunities } from "./suggested-communities";

test("tag prefers the master-data reference name", () => {
  assert.equal(
    communityTag({ name: "Backpackers on Budget", type: "interest", reference_name: "Travel Style" }),
    "Travel Style",
  );
});

test("tag falls back to the kind when the reference just repeats the name", () => {
  assert.equal(
    communityTag({ name: "Accessibility", type: "interest", reference_name: "Accessibility" }),
    "Interest",
  );
  assert.equal(
    communityTag({ name: " accessibility ", type: "interest", reference_name: "Accessibility" }),
    "Interest",
    "comparison ignores surrounding whitespace and case",
  );
});

test("tag falls back to the kind for every community type", () => {
  assert.equal(communityTag({ name: "Mumbai", type: "city", reference_name: null }), "City");
  assert.equal(communityTag({ name: "Fintech", type: "sector" }), "Industry");
  assert.equal(communityTag({ name: "Design Systems Guild", type: "user" }), "Member-led");
  assert.equal(communityTag({ name: "General", type: "general" }), "General");
  assert.equal(communityTag({ name: "Weird", type: "brand_new_type" }), "Community");
});

test("member counts read like the sidebar reference", () => {
  assert.equal(memberCountLabel(1), "1 member");
  assert.equal(memberCountLabel(24), "24 members");
  assert.equal(memberCountLabel(32_700), "32.7K members");
  assert.equal(memberCountLabel(1_200_000), "1.2M members");
  assert.equal(memberCountLabel(2_000), "2K members", "trailing .0 is dropped");
});

test("meta line joins the tag and the member count", () => {
  assert.equal(
    communityMetaLine({
      name: "Backpackers on Budget",
      type: "interest",
      reference_name: "Travel Style",
      member_count: 32_700,
    }),
    "Travel Style · 32.7K members",
  );
});

test("search matching is case-insensitive and empty-safe", () => {
  assert.equal(matchesCommunitySearch("No Dive No Life", ""), true);
  assert.equal(matchesCommunitySearch("No Dive No Life", "   "), true);
  assert.equal(matchesCommunitySearch("No Dive No Life", "dive"), true);
  assert.equal(matchesCommunitySearch("No Dive No Life", "DIVE"), true);
  assert.equal(matchesCommunitySearch("No Dive No Life", "scuba"), false);
});

function explore(
  id: string,
  overrides: Partial<CachedExploreCommunity> = {},
): CachedExploreCommunity {
  return {
    id,
    name: id,
    type: "interest",
    image_url: null,
    description: null,
    member_count: 10,
    joined: false,
    can_join: true,
    ...overrides,
  };
}

test("suggestions exclude communities already followed", () => {
  const all = [explore("a"), explore("b", { joined: true }), explore("c")];
  // "c" was joined moments ago: patched into the sidebar store while the
  // explore snapshot still reports joined: false.
  const picked = selectSuggestedCommunities(all, new Set(["c"]), "");
  assert.deepEqual(picked.map((c) => c.id), ["a"]);
});

test("suggestions exclude communities the viewer cannot join", () => {
  const all = [
    explore("locked", { can_join: false }),
    explore("city", { type: "city" }),
    explore("sector", { type: "sector" }),
    explore("interest"),
  ];
  const picked = selectSuggestedCommunities(all, new Set(), "");
  assert.deepEqual(picked.map((c) => c.id), ["interest"]);
});

test("suggestions honour the search box and the cap", () => {
  const all = [
    explore("Design Systems"),
    explore("Design Research"),
    explore("Frontend"),
    explore("Design Ops"),
  ];
  assert.deepEqual(
    selectSuggestedCommunities(all, new Set(), "design").map((c) => c.name),
    ["Design Systems", "Design Research", "Design Ops"],
  );
  assert.equal(selectSuggestedCommunities(all, new Set(), "", 2).length, 2);
});
