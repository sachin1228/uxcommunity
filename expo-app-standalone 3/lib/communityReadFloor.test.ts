import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import {
  applyCommunityReadFloor,
  communityRowActivityAt,
  recordCommunityReadFloor,
  resetCommunityReadFloors,
} from './communityReadFloor';

const USER = 'user-1';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    unread_count: 3,
    unread_content_count: 2,
    last_message: { created_at: '2026-11-06T10:00:00Z' },
    last_content: { created_at: '2026-11-06T09:00:00Z' },
    ...overrides,
  };
}

beforeEach(() => resetCommunityReadFloors());

test('a payload at or before the floor clears both counts', () => {
  recordCommunityReadFloor(USER, 'c-1', '2026-11-06T10:00:00Z');
  const floored = applyCommunityReadFloor(USER, row());
  assert.equal(floored.unread_count, 0);
  assert.equal(floored.unread_content_count, 0);
});

test('a message newer than the floor still counts', () => {
  recordCommunityReadFloor(USER, 'c-1', '2026-11-06T10:00:00Z');
  assert.equal(
    applyCommunityReadFloor(
      USER,
      row({ last_message: { created_at: '2026-11-06T10:01:00Z' } }),
    ).unread_count,
    3,
  );
});

test('the content half clears on its own when only messages are newer', () => {
  recordCommunityReadFloor(USER, 'c-1', '2026-11-06T10:00:00Z');
  const floored = applyCommunityReadFloor(
    USER,
    row({ last_message: { created_at: '2026-11-06T10:01:00Z' } }),
  );
  assert.equal(floored.unread_count, 3);
  assert.equal(floored.unread_content_count, 0);
});

test('a row without activity has nothing left unread', () => {
  recordCommunityReadFloor(USER, 'c-1', '2026-11-06T10:00:00Z');
  const floored = applyCommunityReadFloor(
    USER,
    row({ last_message: null, last_content: null }),
  );
  assert.equal(floored.unread_count, 0);
  assert.equal(floored.unread_content_count, 0);
});

test('the floor only moves forward and ignores malformed timestamps', () => {
  recordCommunityReadFloor(USER, 'c-1', '2026-11-06T10:00:00Z');
  recordCommunityReadFloor(USER, 'c-1', '2026-11-06T09:00:00Z');
  recordCommunityReadFloor(USER, 'c-1', 'nope');
  recordCommunityReadFloor(USER, 'c-1', null);
  assert.equal(
    applyCommunityReadFloor(
      USER,
      row({ last_message: { created_at: '2026-11-06T09:30:00Z' } }),
    ).unread_count,
    0,
  );
});

test('another community is unaffected', () => {
  recordCommunityReadFloor(USER, 'c-1', '2026-11-06T10:00:00Z');
  assert.equal(applyCommunityReadFloor(USER, row({ id: 'c-2' })).unread_count, 3);
});

test('another member is unaffected', () => {
  recordCommunityReadFloor(USER, 'c-1', '2026-11-06T10:00:00Z');
  assert.equal(applyCommunityReadFloor('user-2', row()).unread_count, 3);
});

test('the newest of a row message and content activity is what an open covers', () => {
  assert.equal(
    communityRowActivityAt({
      last_message: { created_at: '2026-11-06T09:00:00Z' },
      last_content: { created_at: '2026-11-06T10:00:00Z' },
    }),
    '2026-11-06T10:00:00Z',
  );
  assert.equal(
    communityRowActivityAt({
      last_message: { created_at: '2026-11-06T10:00:00Z' },
      last_content: null,
    }),
    '2026-11-06T10:00:00Z',
  );
  assert.equal(communityRowActivityAt({ last_message: null, last_content: null }), null);
});
