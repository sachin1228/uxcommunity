/**
 * Tests for the sidebar's content-activity reconcile — the rule that lets a
 * deleted thread's "created a thread" card and badge finally go away.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Community, LastContent } from './communities';
import { mergeContentActivity } from './sidebarMerge';

function content(overrides: Partial<LastContent> = {}): LastContent {
  return {
    id: 'c1',
    kind: 'thread',
    created_at: '2026-10-01T10:00:00Z',
    isOwn: false,
    firstName: 'john',
    ...overrides,
  };
}

type ContentHalf = Pick<Community, 'last_content' | 'unread_content_count'>;

function row(
  lastContent: LastContent | null,
  unreadContentCount: number,
): ContentHalf {
  return {
    last_content: lastContent,
    unread_content_count: unreadContentCount,
  };
}

test('the server snapshot is authoritative when no insert arrived during the fetch', () => {
  const merged = mergeContentActivity(
    row(content({ id: 'deleted', created_at: '2026-10-02T10:00:00Z' }), 1),
    row(null, 0),
    undefined,
    4,
  );
  assert.deepEqual(merged, { lastContent: null, unreadContentCount: 0 });
});

test('a deletion of the newest item clears the preview and the badge', () => {
  const merged = mergeContentActivity(
    row(content({ id: 'deleted' }), 1),
    row(content({ id: 'older', created_at: '2026-09-30T10:00:00Z' }), 0),
    { id: 'deleted', generation: 2 },
    3,
  );
  assert.deepEqual(merged, {
    lastContent: content({ id: 'older', created_at: '2026-09-30T10:00:00Z' }),
    unreadContentCount: 0,
  });
});

test('an insert applied during the fetch survives a snapshot that predates it', () => {
  const local = content({ id: 'fresh', created_at: '2026-10-03T10:00:00Z' });
  const merged = mergeContentActivity(
    row(local, 1),
    row(null, 0),
    { id: 'fresh', generation: 7 },
    7,
  );
  assert.deepEqual(merged, { lastContent: local, unreadContentCount: 1 });
});

test('an insert applied before the fetch yields to a newer server item', () => {
  const merged = mergeContentActivity(
    row(content({ id: 'local', created_at: '2026-10-01T10:00:00Z' }), 1),
    row(content({ id: 'server', created_at: '2026-10-02T10:00:00Z' }), 2),
    { id: 'local', generation: 6 },
    7,
  );
  assert.deepEqual(merged, {
    lastContent: content({ id: 'server', created_at: '2026-10-02T10:00:00Z' }),
    unreadContentCount: 2,
  });
});

test('a same-item snapshot heals a missing author name', () => {
  const merged = mergeContentActivity(
    row(content({ firstName: null }), 1),
    row(content({ firstName: 'john' }), 1),
    { id: 'c1', generation: 2 },
    2,
  );
  assert.deepEqual(merged, {
    lastContent: content({ firstName: 'john' }),
    unreadContentCount: 1,
  });
});
