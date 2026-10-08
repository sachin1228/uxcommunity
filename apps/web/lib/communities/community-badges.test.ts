import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MEMBER_COMMUNITY_TYPE,
  SIGNUP_COMMUNITY_TYPES,
  communityNameBadges,
  communityVisibility,
  isSignupCommunity,
} from "./community-badges";
import { EVENT_CHAT_COMMUNITY_TYPE } from "./event-chat-rules";

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
  assert.equal(isSignupCommunity("Interest"), false);
});

test("only an explicit true reads as private", () => {
  assert.equal(communityVisibility(true), "private");
  assert.equal(communityVisibility(false), "public");
  assert.equal(communityVisibility(null), "public");
  assert.equal(communityVisibility(undefined), "public");
});

// ─── Badge pairs ──────────────────────────────────────────────────────────────

// The default groups a member gets at signup carry the seal and the lock:
// membership comes only through the signup match, never by browsing, so the
// pair reads as closed by construction.
test("signup default groups show the seal and the lock", () => {
  for (const type of ["city", "sector", "experience_level", "job_title"]) {
    assert.deepEqual(
      communityNameBadges(type, false),
      { verified: true, visibility: "lock" },
      `${type} should show the seal and the lock`,
    );
  }
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

// A default group shows the same pair whether or not it is flagged private —
// the lock is part of what the group is, not a function of that flag.
test("a default group shows the seal and the lock, private or not", () => {
  assert.deepEqual(communityNameBadges("city", true), {
    verified: true,
    visibility: "lock",
  });
});

// An event room is only as open as its event: the badge follows the event's
// "Share publicly" setting, and a flag that cannot be read keeps it closed.
test("an event room follows its event's Share publicly setting", () => {
  assert.deepEqual(communityNameBadges(EVENT_CHAT_COMMUNITY_TYPE, false, true), {
    verified: false,
    visibility: "globe",
  });
  assert.deepEqual(communityNameBadges(EVENT_CHAT_COMMUNITY_TYPE, false, false), {
    verified: false,
    visibility: "lock",
  });
  assert.deepEqual(communityNameBadges(EVENT_CHAT_COMMUNITY_TYPE, false), {
    verified: false,
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
