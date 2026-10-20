/**
 * Tests for the list ordering — ported from the web sidebar's
 * `sidebar-order.test.ts`, including the content-activity key.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Community } from './communities';
import {
  bubbleToTop,
  expiredPinIds,
  isPinned,
  sortByLastActivity,
} from './sidebarOrder';

function community(
  name: string,
  lastMessageAt: string | null,
  overrides: Partial<Community> = {},
): Community {
  return {
    id: name,
    name,
    joined_at: '2026-09-01T00:00:00Z',
    last_message: lastMessageAt
      ? ({
          id: 'm1',
          content: 'hi',
          created_at: lastMessageAt,
          user: { name: 'A' },
          is_reply: false,
          reply_to_user: null,
        } as Community['last_message'])
      : null,
    pinned_until: null,
    ...overrides,
  } as Community;
}

test('presence of a pin deadline is the whole test', () => {
  assert.equal(isPinned(community('A', null, { pinned_until: '2026-10-03T18:30:00Z' })), true);
  assert.equal(isPinned(community('A', null, { pinned_until: null })), false);
});

test('expired pins are the deadlines at or behind the clock', () => {
  const deadline = Date.parse('2026-10-03T18:30:00Z');
  const list = [
    community('room', null, { id: 'a', pinned_until: '2026-10-03T18:30:00Z' }),
    community('later', null, { id: 'b', pinned_until: '2026-10-03T18:30:01Z' }),
    community('plain', null, { id: 'c' }),
  ];
  assert.deepEqual(expiredPinIds(list, deadline), ['a']);
});

test('unreadable pin values are never expired', () => {
  const deadline = Date.parse('2026-10-03T18:30:00Z');
  assert.deepEqual(expiredPinIds([community('Odd', null, { id: 'c', pinned_until: 'not a date' })], deadline), []);
});

test('pinned event rooms ride above more recently active communities', () => {
  const list = [
    community('Chatty', '2026-10-03T18:30:00Z'),
    community('Designup decade', null, { id: 'a', pinned_until: '2026-09-25T13:30:00Z' }),
  ];
  assert.equal(sortByLastActivity(list)[0]?.id, 'a');
});

test('among pinned rooms the newest membership is first', () => {
  const list = [
    community('Older event', '2026-10-03T18:30:00Z', {
      id: 'a',
      pinned_until: '2026-10-03T18:30:00Z',
      joined_at: '2026-09-20T00:00:00Z',
    }),
    community('Newer event', null, {
      id: 'b',
      pinned_until: '2026-09-27T11:00:00Z',
      joined_at: '2026-09-27T00:00:00Z',
    }),
  ];
  assert.equal(sortByLastActivity(list)[0]?.id, 'b');
});

test('without pins the newest activity wins, falling back to joined_at', () => {
  const list = [
    community('Old chat', '2026-09-01T10:00:00Z', { id: 'a' }),
    community('No messages', null, { id: 'b', joined_at: '2026-10-02T00:00:00Z' }),
    community('Recent chat', '2026-10-01T10:00:00Z', { id: 'c' }),
  ];
  assert.deepEqual(
    sortByLastActivity(list).map((c) => c.id),
    ['b', 'c', 'a'],
  );
});

test('a newer content notification outranks the newest message', () => {
  const list = [
    community('Chatty', '2026-10-01T10:00:00Z', { id: 'm' }),
    community('Thread room', null, {
      id: 't',
      last_content: {
        id: 'thread-1',
        kind: 'thread',
        created_at: '2026-10-02T10:00:00Z',
        isOwn: false,
        firstName: 'john',
      },
    }),
  ];
  assert.deepEqual(
    sortByLastActivity(list).map((c) => c.id),
    ['t', 'm'],
  );
});

test('a message newer than the content item keeps its row above it', () => {
  const list = [
    community('Thread room', '2026-10-02T10:00:00Z', {
      id: 't',
      last_content: {
        id: 'thread-1',
        kind: 'thread',
        created_at: '2026-10-01T10:00:00Z',
        isOwn: false,
        firstName: 'john',
      },
    }),
    community('Chatty', '2026-10-03T10:00:00Z', { id: 'm' }),
  ];
  assert.deepEqual(
    sortByLastActivity(list).map((c) => c.id),
    ['m', 't'],
  );
});

test('ties fall back to the name, like the web sidebar', () => {
  const list = [
    community('Zeta', '2026-10-01T10:00:00Z', { id: 'z' }),
    community('Alpha', '2026-10-01T10:00:00Z', { id: 'al' }),
  ];
  assert.deepEqual(
    sortByLastActivity(list).map((c) => c.id),
    ['al', 'z'],
  );
});

test('a message bubbles its community to the top', () => {
  const list = [community('A', '2026-10-03T00:00:00Z'), community('B', null), community('C', null)];
  assert.deepEqual(
    bubbleToTop(list, 'C').map((c) => c.id),
    ['C', 'A', 'B'],
  );
});

test('a bubble never overtakes a pinned event room', () => {
  const list = [
    community('Event', null, { id: 'e', pinned_until: '2026-10-04T00:00:00Z' }),
    community('A', '2026-10-03T00:00:00Z', { id: 'a' }),
    community('B', null, { id: 'b' }),
  ];
  assert.deepEqual(
    bubbleToTop(list, 'b').map((c) => c.id),
    ['e', 'b', 'a'],
  );
});

test('a message in a pinned room takes the very top', () => {
  const list = [
    community('Event one', null, { id: 'e1', pinned_until: '2026-10-04T00:00:00Z' }),
    community('Event two', null, { id: 'e2', pinned_until: '2026-10-05T00:00:00Z' }),
    community('A', null, { id: 'a' }),
  ];
  assert.deepEqual(
    bubbleToTop(list, 'e1').map((c) => c.id),
    ['e1', 'e2', 'a'],
  );
});

test('bubbling an unknown id leaves the order untouched', () => {
  const list = [community('A', null), community('B', null)];
  assert.deepEqual(
    bubbleToTop(list, 'missing').map((c) => c.id),
    ['A', 'B'],
  );
});
