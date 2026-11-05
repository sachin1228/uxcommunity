/**
 * Tests for the community mute model — ported from the web app's
 * `mute.test.ts`. The boundary semantics matter: a lapsed timed mute reads as
 * unmuted without the row ever being rewritten.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { communityMuteLabel, isCommunityMuted } from './communityMute';

const NOW = Date.parse('2026-10-11T12:00:00Z');

test('the forever flag mutes regardless of any deadline', () => {
  assert.equal(isCommunityMuted({ notifications_muted: true }, NOW), true);
  assert.equal(
    isCommunityMuted({ notifications_muted: true, notifications_muted_until: null }, NOW),
    true,
  );
});

test('a timed mute is active while its deadline is ahead', () => {
  assert.equal(
    isCommunityMuted({ notifications_muted_until: '2026-10-11T20:00:00Z' }, NOW),
    true,
  );
});

test('an expired timed mute reads as unmuted without the row being rewritten', () => {
  assert.equal(
    isCommunityMuted({ notifications_muted_until: '2026-10-11T11:59:59Z' }, NOW),
    false,
  );
  // Exactly at the deadline counts as expired — the mute ends when it ends.
  assert.equal(
    isCommunityMuted({ notifications_muted_until: '2026-10-11T12:00:00Z' }, NOW),
    false,
  );
});

test('missing state, missing deadline and the false flag all read as unmuted', () => {
  assert.equal(isCommunityMuted(null, NOW), false);
  assert.equal(isCommunityMuted(undefined, NOW), false);
  assert.equal(isCommunityMuted({}, NOW), false);
  assert.equal(isCommunityMuted({ notifications_muted: false }, NOW), false);
  assert.equal(isCommunityMuted({ notifications_muted_until: null }, NOW), false);
  assert.equal(isCommunityMuted({ notifications_muted: false, notifications_muted_until: '' }, NOW), false);
});

test('an unparseable deadline never mutes (fail open, notifications continue)', () => {
  assert.equal(isCommunityMuted({ notifications_muted_until: 'not-a-date' }, NOW), false);
});

test('the sheet label says "Muted" for the forever flag and names a timed deadline', () => {
  assert.equal(communityMuteLabel({ notifications_muted: true }, NOW), 'Muted');
  assert.equal(
    communityMuteLabel(
      { notifications_muted: true, notifications_muted_until: '2026-10-11T20:00:00Z' },
      NOW,
    ),
    'Muted',
  );

  const timed = communityMuteLabel(
    { notifications_muted_until: '2026-10-11T20:00:00Z' },
    NOW,
  );
  assert.ok(timed?.startsWith('Muted until '), `unexpected label: ${timed}`);
});

test('the sheet label is null whenever the membership reads as unmuted', () => {
  assert.equal(communityMuteLabel(null, NOW), null);
  assert.equal(communityMuteLabel({}, NOW), null);
  assert.equal(communityMuteLabel({ notifications_muted: false }, NOW), null);
  assert.equal(
    communityMuteLabel({ notifications_muted_until: '2026-10-11T11:59:59Z' }, NOW),
    null,
  );
  assert.equal(
    communityMuteLabel({ notifications_muted_until: 'not-a-date' }, NOW),
    null,
  );
});
