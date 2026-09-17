import assert from "node:assert/strict";
import { test } from "node:test";
import type { CachedExploreCommunity } from "@/lib/communities/cache";
import { communityTag, memberCountLabel } from "./community-label";
import { matchesCommunitySearch, selectSuggestedCommunities } from "./suggested-communities";

test("tag reads as the community's kind", () => {
  assert.equal(communityTag("interest"), "Interest");
  assert.equal(communityTag("city"), "City");
  assert.equal(communityTag("sector"), "Industry");
  assert.equal(communityTag("experience_level"), "Experience");
  assert.equal(communityTag("job_title"), "Job Title");
  assert.equal(communityTag("general"), "General");
  assert.equal(communityTag("user"), "Member-led");
  assert.equal(communityTag("brand_new_type"), "Community");
});

test("member counts match the Following rows' format", () => {
  assert.equal(memberCountLabel(1), "1 member");
  assert.equal(memberCountLabel(24), "24 members");
  assert.equal(memberCountLabel(32_700), "32.7k members");
  assert.equal(memberCountLabel(1_200_000), "1.2M members");
  assert.equal(memberCountLabel(2_000), "2k members", "a trailing .0 is dropped");
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
