import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MEMBER_COMMUNITY_TYPE,
  SIGNUP_COMMUNITY_TYPES,
  communityNameBadges,
  communityVisibility,
  isSignupCommunity,
} from "./community-badges";

// The badge is a trust signal, so it must follow the allow-list exactly: every
// type the signup flow creates gets the seal, and nothing else does.
test("every community type created by the signup flow is verified", () => {
  for (const type of SIGNUP_COMMUNITY_TYPES) {
    assert.equal(isSignupCommunity(type), true, `${type} should be verified`);
  }
});

test("member-created communities are not verified", () => {
  assert.equal(isSignupCommunity(MEMBER_COMMUNITY_TYPE), false);
  // Unknown/new types stay unverified until they are added to the allow-list.
  assert.equal(isSignupCommunity("competition"), false);
  assert.equal(isSignupCommunity(""), false);
  assert.equal(isSignupCommunity(null), false);
  assert.equal(isSignupCommunity(undefined), false);
});

test("verification is case sensitive so a hand-crafted name can't spoof it", () => {
  assert.equal(isSignupCommunity("General"), false);
});

test("only an explicit true reads as private", () => {
  assert.equal(communityVisibility(true), "private");
  assert.equal(communityVisibility(false), "public");
  assert.equal(communityVisibility(null), "public");
  assert.equal(communityVisibility(undefined), "public");
});

// ─── Badge pairs ──────────────────────────────────────────────────────────────

// The default groups a member gets at signup carry the seal and nothing else:
// an earth beside the seal would be noise, and those groups are not discovered
// by browsing.
test("signup default groups show the seal alone", () => {
  for (const type of ["general", "city", "sector", "experience_level", "job_title"]) {
    assert.deepEqual(
      communityNameBadges(type, false),
      { verified: true, visibility: null },
      `${type} should show the seal alone`,
    );
  }
});

// Interest communities are the public topic groups, so the earth says more
// about them than the seal would — and only one badge keeps the row calm.
test("interest communities show the earth instead of the seal", () => {
  assert.deepEqual(communityNameBadges("interest", false), {
    verified: false,
    visibility: "globe",
  });
  assert.deepEqual(communityNameBadges("interest", undefined), {
    verified: false,
    visibility: "globe",
  });
});

test("a member-created community shows earth when public, lock when private", () => {
  assert.deepEqual(communityNameBadges(MEMBER_COMMUNITY_TYPE, false), {
    verified: false,
    visibility: "globe",
  });
  assert.deepEqual(communityNameBadges(MEMBER_COMMUNITY_TYPE, true), {
    verified: false,
    visibility: "lock",
  });
});

// A default group switched to private keeps its seal and gains the lock, so the
// member can still tell it came from the platform.
test("a private default group keeps the seal and gains the lock", () => {
  assert.deepEqual(communityNameBadges("city", true), {
    verified: true,
    visibility: "lock",
  });
});

// Unknown types get nothing public — a badge would imply a promise the platform
// has not made about that kind of community.
test("an unknown type gets no public badge", () => {
  assert.deepEqual(communityNameBadges("competition", false), {
    verified: false,
    visibility: null,
  });
  assert.deepEqual(communityNameBadges(null, false), {
    verified: false,
    visibility: null,
  });
});
