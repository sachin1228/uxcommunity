/**
 * Tests for the community name badges — ported from the web app's
 * `community-badges.test.ts`. The badge is a trust signal, so it must follow
 * the allow-list exactly: every type the signup flow creates gets the seal,
 * and nothing else does.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  EVENT_CHAT_COMMUNITY_TYPE,
  MEMBER_COMMUNITY_TYPE,
  SIGNUP_COMMUNITY_TYPES,
  communityNameBadges,
  communityVisibility,
  isSignupCommunity,
} from './communityBadges';

test('every community type created by the signup flow is verified', () => {
  for (const type of SIGNUP_COMMUNITY_TYPES) {
    assert.equal(isSignupCommunity(type), true, `${type} should be verified`);
  }
});

test('member-created communities are not verified', () => {
  assert.equal(isSignupCommunity(MEMBER_COMMUNITY_TYPE), false);
  // Unknown/new types stay unverified until they are added to the allow-list.
  assert.equal(isSignupCommunity('competition'), false);
  assert.equal(isSignupCommunity(''), false);
  assert.equal(isSignupCommunity(null), false);
  assert.equal(isSignupCommunity(undefined), false);
});

test('verification is case sensitive so a hand-crafted name cannot spoof it', () => {
  assert.equal(isSignupCommunity('Interest'), false);
});

test('only an explicit true reads as private', () => {
  assert.equal(communityVisibility(true), 'private');
  assert.equal(communityVisibility(false), 'public');
  assert.equal(communityVisibility(null), 'public');
  assert.equal(communityVisibility(undefined), 'public');
});

test('signup default groups show the seal and the lock', () => {
  for (const type of ['city', 'sector', 'experience_level', 'job_title']) {
    assert.deepEqual(
      communityNameBadges(type, false),
      { verified: true, visibility: 'lock' },
      `${type} should show the seal and the lock`,
    );
  }
});

test('a member-created community shows globe when public, lock when private', () => {
  assert.deepEqual(communityNameBadges(MEMBER_COMMUNITY_TYPE, false), {
    verified: false,
    visibility: 'globe',
  });
  assert.deepEqual(communityNameBadges(MEMBER_COMMUNITY_TYPE, true), {
    verified: false,
    visibility: 'lock',
  });
});

test('a default group shows the seal and the lock, private or not', () => {
  assert.deepEqual(communityNameBadges('city', true), {
    verified: true,
    visibility: 'lock',
  });
});

test('an event room follows its room\'s public/private setting', () => {
  assert.deepEqual(communityNameBadges(EVENT_CHAT_COMMUNITY_TYPE, false), {
    verified: false,
    visibility: 'globe',
  });
  assert.deepEqual(communityNameBadges(EVENT_CHAT_COMMUNITY_TYPE, true), {
    verified: false,
    visibility: 'lock',
  });
});

test('an unknown type gets no public badge', () => {
  assert.deepEqual(communityNameBadges('competition', false), {
    verified: false,
    visibility: null,
  });
  assert.deepEqual(communityNameBadges(null, false), {
    verified: false,
    visibility: null,
  });
});
