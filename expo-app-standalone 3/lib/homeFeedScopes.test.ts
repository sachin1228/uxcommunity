/**
 * Tests for the home feed scope rules — the stored choice must land on a real
 * tab (the legacy `all` choice included).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_HOME_FEED_TAB_SCOPE,
  HOME_FEED_TAB_SCOPES,
  normalizeStoredHomeFeedScope,
} from './homeFeedScopes';

test('the tabs are the two disjoint scopes, public first', () => {
  assert.deepEqual([...HOME_FEED_TAB_SCOPES], ['public', 'communities']);
  assert.equal(DEFAULT_HOME_FEED_TAB_SCOPE, 'public');
});

test('legacy all, null and unknown values land on the default tab', () => {
  assert.equal(normalizeStoredHomeFeedScope('all'), 'public');
  assert.equal(normalizeStoredHomeFeedScope(null), 'public');
  assert.equal(normalizeStoredHomeFeedScope(undefined), 'public');
  assert.equal(normalizeStoredHomeFeedScope('bogus'), 'public');
});

test('a stored communities choice survives', () => {
  assert.equal(normalizeStoredHomeFeedScope('communities'), 'communities');
});
