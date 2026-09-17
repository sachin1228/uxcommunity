import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MEMBER_COMMUNITY_TYPE,
  SIGNUP_COMMUNITY_TYPES,
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
