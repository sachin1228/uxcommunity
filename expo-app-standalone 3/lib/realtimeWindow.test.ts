/**
 * Socket-budget tests for the mobile community list.
 *
 * The production finding this pins: mobile opened one WebSocket per subscribed
 * community, so a member of 30 communities carried 30 sockets. The fix is a
 * policy module (`realtimeWindow.ts`) rather than a client rewrite, so these
 * tests assert the policy itself: the live set never exceeds the limit, the
 * limit is what caps a 1/10/50/100-community member to the same socket count,
 * and the window is the head of the activity-sorted list.
 *
 * The client-level consequences (one socket per live community, one reconnect
 * per socket, no leaks on release) are covered in `realtimeScale.test.ts`, which
 * drives the real `RealtimeClient` with a fake platform.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_REALTIME_LIMIT,
  selectLiveCommunityIds,
} from './realtimeWindow';

/** Ids for n communities, as the community list would hand them over. */
function communityIds(n: number): string[] {
  return Array.from({ length: n }, (_, index) => `community-${index + 1}`);
}

test('the budget is the same ten communities no matter how many memberships there are', () => {
  for (const total of [1, 10, 50, 100]) {
    const ids = communityIds(total);
    const live = selectLiveCommunityIds(ids);
    assert.equal(
      live.length,
      Math.min(total, COMMUNITY_REALTIME_LIMIT),
      `${total} communities must keep ${Math.min(total, COMMUNITY_REALTIME_LIMIT)} sockets`,
    );
    assert.deepEqual(live, ids.slice(0, Math.min(total, COMMUNITY_REALTIME_LIMIT)));
  }
});

test('a 100-community member does not get more sockets than a 10-community member', () => {
  assert.equal(
    selectLiveCommunityIds(communityIds(100)).length,
    selectLiveCommunityIds(communityIds(10)).length,
  );
});

test('the window is the head of the caller order, which is most-recently-active first', () => {
  // The list is sorted by last activity (and bubbles a community to the top on
  // a new message), so the head is the set most likely to change next; the tail
  // is what the reconcile has to cover.
  const ids = ['hot', 'warm', 'lukewarm', ...communityIds(20)];
  const live = selectLiveCommunityIds(ids);
  assert.equal(live[0], 'hot');
  assert.equal(live[1], 'warm');
  assert.equal(live.length, COMMUNITY_REALTIME_LIMIT);
  assert.ok(!live.includes('community-20'), 'the tail stays out of the window');
});

test('duplicate ids do not spend the socket budget twice', () => {
  const live = selectLiveCommunityIds(['a', 'a', 'b', 'a', 'c']);
  assert.deepEqual(live, ['a', 'b', 'c']);
});

test('empty ids are dropped instead of opening a socket with no room', () => {
  const live = selectLiveCommunityIds(['', 'a', '', 'b']);
  assert.deepEqual(live, ['a', 'b']);
});

test('the result is always a new array, so callers cannot mutate shared state', () => {
  const ids = ['a', 'b'];
  const live = selectLiveCommunityIds(ids);
  live.push('c');
  assert.deepEqual(ids, ['a', 'b']);
});

test('a non-positive limit keeps no sockets (used by tests and kill switches)', () => {
  assert.deepEqual(selectLiveCommunityIds(communityIds(5), 0), []);
  assert.deepEqual(selectLiveCommunityIds(communityIds(5), -1), []);
});

test('a custom limit is honoured, so the budget can be tuned without touching the hook', () => {
  assert.equal(selectLiveCommunityIds(communityIds(50), 3).length, 3);
  assert.equal(selectLiveCommunityIds(communityIds(2), 3).length, 2, 'never invents sockets');
});

test('an empty list keeps zero sockets', () => {
  assert.deepEqual(selectLiveCommunityIds([]), []);
});
