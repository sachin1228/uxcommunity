/**
 * Tests for the Home feed's source axis — the mobile counterpart of the web's
 * home-feed-options coverage. The stored choice decides which feed opens, so an
 * unknown value must never leak through.
 *
 * The helpers take their storage, so these run on plain Node — no React Native
 * import (the AsyncStorage binding lives in homeFeedScopeStore.ts).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_HOME_FEED_SCOPE,
  HOME_FEED_SCOPE_STORAGE_KEY,
  HOME_FEED_TAB_SCOPES,
  hydrateHomeFeedScope,
  isHomeFeedScope,
  persistHomeFeedScope,
  type HomeFeedScopeStorage,
} from './homeFeedScope';

/** A recording in-memory storage standing in for AsyncStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

test('the feed opens on all posts and offers two tabs', () => {
  assert.equal(DEFAULT_HOME_FEED_SCOPE, 'all');
  assert.deepEqual([...HOME_FEED_TAB_SCOPES], ['all', 'communities']);
  for (const scope of HOME_FEED_TAB_SCOPES) {
    assert.ok(isHomeFeedScope(scope), `${scope} is a valid scope`);
  }
});

test('a stored tab choice is returned as-is', async () => {
  const storage = fakeStorage({ [HOME_FEED_SCOPE_STORAGE_KEY]: 'communities' });
  assert.equal(await hydrateHomeFeedScope(storage), 'communities');
});

test('a missing stored value yields no choice', async () => {
  assert.equal(await hydrateHomeFeedScope(fakeStorage()), null);
});

test('the retired public filter opens the unified feed', async () => {
  const storage = fakeStorage({ [HOME_FEED_SCOPE_STORAGE_KEY]: 'public' });
  assert.equal(await hydrateHomeFeedScope(storage), 'all');
});

test('unknown stored values are rejected', async () => {
  for (const value of ['yesterday', '', 'PUBLIC', 'ALL']) {
    const storage = fakeStorage({ [HOME_FEED_SCOPE_STORAGE_KEY]: value });
    assert.equal(await hydrateHomeFeedScope(storage), null, `${value} is not a tab`);
  }
});

test('the chosen tab round-trips through storage', async () => {
  const storage = fakeStorage();
  await persistHomeFeedScope(storage, 'communities');
  assert.equal(storage.store.get(HOME_FEED_SCOPE_STORAGE_KEY), 'communities');
  assert.equal(await hydrateHomeFeedScope(storage), 'communities');

  await persistHomeFeedScope(storage, DEFAULT_HOME_FEED_SCOPE);
  assert.equal(await hydrateHomeFeedScope(storage), DEFAULT_HOME_FEED_SCOPE);
});

test('unavailable storage never throws and yields no stored choice', async () => {
  const broken: HomeFeedScopeStorage = {
    getItem: async () => {
      throw new Error('storage blocked');
    },
    setItem: async () => {
      throw new Error('storage blocked');
    },
  };

  assert.equal(await hydrateHomeFeedScope(broken), null);
  await assert.doesNotReject(() => persistHomeFeedScope(broken, 'all'));
});

test('every scope value is distinct', () => {
  assert.equal(new Set(HOME_FEED_TAB_SCOPES).size, HOME_FEED_TAB_SCOPES.length);
});
