import assert from 'node:assert/strict';
import test from 'node:test';

import { newestMessageAt } from './chat';

test('the newest server row wins, whatever order the window is in', () => {
  assert.equal(
    newestMessageAt([
      { id: 'm-2', created_at: '2026-11-06T10:02:00Z' },
      { id: 'm-1', created_at: '2026-11-06T10:00:00Z' },
    ]),
    '2026-11-06T10:02:00Z',
  );
});

test('optimistic rows never become the read watermark', () => {
  assert.equal(
    newestMessageAt([
      { id: 'm-1', created_at: '2026-11-06T10:00:00Z' },
      { id: 'temp-1', created_at: '2026-11-06T12:00:00Z' },
    ]),
    '2026-11-06T10:00:00Z',
  );
});

test('an empty or missing window has no watermark', () => {
  assert.equal(newestMessageAt([]), null);
  assert.equal(newestMessageAt(null), null);
  assert.equal(
    newestMessageAt([{ id: 'temp-1', created_at: '2026-11-06T12:00:00Z' }]),
    null,
  );
});
