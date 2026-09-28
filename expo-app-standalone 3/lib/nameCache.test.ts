/**
 * Bounded-cache tests for resolved sender names.
 *
 * The production finding these pin: the community list remembered every sender
 * name it ever resolved in a lifetime-long `Map`, so an account that visits many
 * communities accumulated an unbounded id→name table. The fix is a cap on the
 * cache, so these tests assert the cap holds while the names that matter most
 * (the most recently written ones) survive.
 *
 * `hooks/useCommunities.ts` imports React Native and cannot run on the CI
 * runner, so the policy is tested here against the module the hook uses.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_NAME_CACHE_MAX_ENTRIES,
  createNameCache,
} from './nameCache';

test('remembers a resolved name and reports it back', () => {
  const cache = createNameCache();

  assert.equal(cache.has('u1'), false);
  assert.equal(cache.get('u1'), undefined);

  cache.set('u1', 'Ada');

  assert.equal(cache.has('u1'), true);
  assert.equal(cache.get('u1'), 'Ada');
  assert.equal(cache.size(), 1);
});

test('never grows past the cap, however many senders are seen', () => {
  const cache = createNameCache(50);

  for (let i = 0; i < 5000; i++) {
    cache.set(`u${i}`, `Sender ${i}`);
  }

  assert.equal(cache.size(), 50);
  // The newest writes are the ones kept.
  assert.equal(cache.get('u4999'), 'Sender 4999');
  assert.equal(cache.get('u0'), undefined);
});

test('the default cap bounds a long-lived session', () => {
  const cache = createNameCache();

  for (let i = 0; i < DEFAULT_NAME_CACHE_MAX_ENTRIES * 4; i++) {
    cache.set(`u${i}`, `Sender ${i}`);
  }

  assert.equal(cache.size(), DEFAULT_NAME_CACHE_MAX_ENTRIES);
});

test('evicts the coldest name, not the one just written', () => {
  const cache = createNameCache(3);

  cache.set('u1', 'One');
  cache.set('u2', 'Two');
  cache.set('u3', 'Three');

  // u2 is seen again — it is now the most recent write.
  cache.set('u2', 'Two');

  // u1 is now the coldest, so it goes first.
  cache.set('u4', 'Four');

  assert.equal(cache.size(), 3);
  assert.equal(cache.get('u1'), undefined);
  assert.equal(cache.get('u2'), 'Two');
  assert.equal(cache.get('u3'), 'Three');
  assert.equal(cache.get('u4'), 'Four');
});

test('a re-resolved name replaces the previous one', () => {
  const cache = createNameCache(2);

  cache.set('u1', 'Old Name');
  cache.set('u1', 'New Name');

  assert.equal(cache.size(), 1);
  assert.equal(cache.get('u1'), 'New Name');
});

test('a nonsensical cap cannot disable the cache', () => {
  const cache = createNameCache(0);

  cache.set('u1', 'Ada');

  assert.equal(cache.size(), 1);
  assert.equal(cache.get('u1'), 'Ada');
});

test('clear drops every remembered name', () => {
  const cache = createNameCache();

  cache.set('u1', 'Ada');
  cache.set('u2', 'Grace');
  cache.clear();

  assert.equal(cache.size(), 0);
  assert.equal(cache.has('u1'), false);
});
