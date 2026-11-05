import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

import { applyDmReadFloor, recordDmReadFloor, resetDmReadFloors } from './dmReadFloor';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    unread_count: 3,
    last_message_at: '2026-11-05T10:00:00Z',
    ...overrides,
  };
}

beforeEach(() => resetDmReadFloors());

test('a payload at or before the floor keeps the cleared count', () => {
  recordDmReadFloor('c-1', '2026-11-05T10:00:00Z');
  assert.equal(applyDmReadFloor(row()).unread_count, 0);
});

test('a message newer than the floor still counts', () => {
  recordDmReadFloor('c-1', '2026-11-05T10:00:00Z');
  assert.equal(
    applyDmReadFloor(row({ last_message_at: '2026-11-05T10:01:00Z' })).unread_count,
    3,
  );
});

test('the floor only moves forward and ignores malformed timestamps', () => {
  recordDmReadFloor('c-1', '2026-11-05T10:00:00Z');
  recordDmReadFloor('c-1', '2026-11-05T09:00:00Z');
  recordDmReadFloor('c-1', 'nope');
  recordDmReadFloor('c-1', null);
  assert.equal(
    applyDmReadFloor(row({ last_message_at: '2026-11-05T09:30:00Z' })).unread_count,
    0,
  );
});

test('another conversation is unaffected', () => {
  recordDmReadFloor('c-1', '2026-11-05T10:00:00Z');
  assert.equal(applyDmReadFloor(row({ id: 'c-2' })).unread_count, 3);
});
