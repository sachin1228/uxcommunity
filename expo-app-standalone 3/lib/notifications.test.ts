/**
 * Tests for the pure notifications module — the rules the app shares with the
 * web client (tab classification, seen watermark, deep-link mapping).
 *
 * `hooks/useNotifications.ts`, the screen and `lib/notificationsSeen.ts` import
 * React Native / AsyncStorage and cannot run on the CI runner, so the policy
 * they apply is tested here against the module they all use.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_NOTIFICATION_ITEMS,
  countUnseenSince,
  createSeenStore,
  formatRelativeTime,
  newestCreatedAt,
  notificationRouteFor,
  notificationTabFor,
  seenStorageKey,
  splitNotificationsByTab,
  type NotificationItem,
  type NotificationType,
} from './notifications';

interface Row {
  type: NotificationType;
  read_at: string | null;
  created_at?: string;
}

function row(type: NotificationType, read_at: string | null = null, created_at?: string): Row {
  return { type, read_at, created_at };
}

// ---------------------------------------------------------------------------
// Tab classification
// ---------------------------------------------------------------------------

test('splits every claimed type into its tab (same map as the web)', () => {
  const { activity, events, jobs, other } = splitNotificationsByTab([
    row('thread_like'),
    row('thread_comment', '2026-01-01T00:00:00.000Z'),
    row('thread_reply'),
    row('resource_comment'),
    row('resource_reply'),
    row('event_comment'),
    row('event_reply'),
    row('event_rsvp'),
    row('job_match'),
    row('thread_deleted'),
    row('showcase_deleted'),
    row('resource_deleted'),
    row('event_deleted'),
    row('report_reviewed'),
    row('content_restored'),
    row('join_request_accepted'),
  ]);

  assert.equal(activity.length, 5);
  assert.equal(events.length, 3);
  assert.equal(jobs.length, 1);
  assert.equal(other.length, 7);
});

test('counts unread per tab while splitting', () => {
  const { unreadByTab } = splitNotificationsByTab([
    row('thread_like'),
    row('thread_comment', '2026-01-01T00:00:00.000Z'),
    row('event_rsvp'),
    row('job_match'),
    row('job_match'),
  ]);

  assert.deepEqual(unreadByTab, { activity: 1, events: 1, jobs: 2, other: 0 });
});

test('drops types no tab claims from every list and count', () => {
  const unknown = { type: 'future_type' as NotificationType, read_at: null };
  const { activity, events, jobs, other, unreadByTab } = splitNotificationsByTab([unknown]);

  assert.equal(activity.length + events.length + jobs.length + other.length, 0);
  assert.deepEqual(unreadByTab, { activity: 0, events: 0, jobs: 0, other: 0 });
  assert.equal(notificationTabFor('future_type' as NotificationType), null);
});

// ---------------------------------------------------------------------------
// Seen watermark store
// ---------------------------------------------------------------------------

function createFakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const sets: Array<{ key: string; value: string }> = [];
  return {
    sets,
    data,
    storage: {
      getItem: async (key: string) => data.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        sets.push({ key, value });
        data.set(key, value);
      },
    },
  };
}

test('hydrate loads the persisted watermark once, per user', async () => {
  const { storage } = createFakeStorage({ [seenStorageKey('u1')]: '2026-01-02T00:00:00.000Z' });
  const store = createSeenStore(storage);

  assert.equal(store.read('u1'), null, 'nothing before hydration');
  assert.equal(await store.hydrate('u1'), '2026-01-02T00:00:00.000Z');
  assert.equal(store.read('u1'), '2026-01-02T00:00:00.000Z');
  assert.equal(store.read('u2'), null, 'watermarks are per user');
});

test('hydrate notifies subscribers so live badges re-read the value', async () => {
  const { storage } = createFakeStorage({ [seenStorageKey('u1')]: '2026-01-02T00:00:00.000Z' });
  const store = createSeenStore(storage);
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  await store.hydrate('u1');
  assert.equal(notifications, 1);
});

test('advance is monotonic — a stale list cannot move the watermark backwards', () => {
  const { storage, sets } = createFakeStorage();
  const store = createSeenStore(storage);

  assert.equal(store.advance('u1', '2026-01-02T00:00:00.000Z'), true);
  assert.equal(store.advance('u1', '2026-01-01T00:00:00.000Z'), false);
  assert.equal(store.advance('u1', '2026-01-02T00:00:00.000Z'), false, 'equal is not an advance');
  assert.equal(store.read('u1'), '2026-01-02T00:00:00.000Z');
  assert.equal(sets.length, 1, 'rejected advances are not persisted');
});

test('advance persists the watermark and notifies subscribers', async () => {
  const { storage, data } = createFakeStorage();
  const store = createSeenStore(storage);
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });

  store.advance('u1', '2026-01-03T00:00:00.000Z');
  await Promise.resolve();
  assert.equal(data.get(seenStorageKey('u1')), '2026-01-03T00:00:00.000Z');
  assert.equal(notifications, 1);
});

test('forget drops the cached copy so the next hydrate hits storage again', async () => {
  const { storage, data } = createFakeStorage({ [seenStorageKey('u1')]: '2026-01-02T00:00:00.000Z' });
  const store = createSeenStore(storage);

  await store.hydrate('u1');
  data.set(seenStorageKey('u1'), '2026-01-05T00:00:00.000Z');
  store.forget('u1');

  assert.equal(store.read('u1'), null);
  assert.equal(await store.hydrate('u1'), '2026-01-05T00:00:00.000Z');
});

// ---------------------------------------------------------------------------
// Unseen counting
// ---------------------------------------------------------------------------

test('counts unread rows strictly newer than the watermark', () => {
  const items = [
    { read_at: null, created_at: '2026-01-01T00:00:01.000Z' }, // newer, unread → counts
    { read_at: null, created_at: '2026-01-01T00:00:00.000Z' }, // equal → does not count
    { read_at: null, created_at: '2025-12-31T23:59:59.000Z' }, // older → does not count
    { read_at: '2026-01-01T00:00:00.000Z', created_at: '2026-01-01T00:00:02.000Z' }, // read → no
  ];

  assert.equal(countUnseenSince(items, '2026-01-01T00:00:00.000Z'), 1);
});

test('newestCreatedAt finds the latest row regardless of order', () => {
  assert.equal(
    newestCreatedAt([
      { created_at: '2026-01-01T00:00:00.000Z' },
      { created_at: '2026-01-03T00:00:00.000Z' },
      { created_at: '2026-01-02T00:00:00.000Z' },
    ]),
    '2026-01-03T00:00:00.000Z',
  );
  assert.equal(newestCreatedAt([]), null);
});

// ---------------------------------------------------------------------------
// Deep-link mapping
// ---------------------------------------------------------------------------

test('maps community content links to the community screen with the right tab', () => {
  assert.deepEqual(
    notificationRouteFor('/dashboard/communities/c1/threads/t1'),
    { pathname: '/community/[id]', params: { id: 'c1', tab: 'threads' } },
  );
  assert.deepEqual(
    notificationRouteFor('/dashboard/communities/c1/showcase/s1'),
    { pathname: '/community/[id]', params: { id: 'c1', tab: 'showcase' } },
  );
  assert.deepEqual(
    notificationRouteFor('/dashboard/communities/c1/resources/r1'),
    { pathname: '/community/[id]', params: { id: 'c1', tab: 'resources' } },
  );
  assert.deepEqual(
    notificationRouteFor('/dashboard/communities/c1/events/e1'),
    { pathname: '/community/[id]', params: { id: 'c1', tab: 'events' } },
  );
});

test('maps a bare community link (removals, accepted join requests) to its chat', () => {
  assert.deepEqual(notificationRouteFor('/dashboard/communities/c1'), {
    pathname: '/community/[id]',
    params: { id: 'c1' },
  });
  // Trailing slash tolerated.
  assert.deepEqual(notificationRouteFor('/dashboard/communities/c1/'), {
    pathname: '/community/[id]',
    params: { id: 'c1' },
  });
});

test('maps job links to the job detail', () => {
  assert.deepEqual(notificationRouteFor('/dashboard/jobs/j1'), {
    pathname: '/jobs/[id]',
    params: { id: 'j1' },
  });
});

test('unknown or malformed hrefs map to null (row stays non-navigating)', () => {
  assert.equal(notificationRouteFor('/dashboard/saved'), null);
  assert.equal(notificationRouteFor('/dashboard'), null);
  assert.equal(notificationRouteFor('https://example.com/x'), null);
  assert.equal(notificationRouteFor(''), null);
  assert.equal(notificationRouteFor(null), null);
  assert.equal(notificationRouteFor(undefined), null);
  assert.equal(notificationRouteFor(42), null);
});

// ---------------------------------------------------------------------------
// Relative time
// ---------------------------------------------------------------------------

test('formats relative time in the same buckets as the web view', () => {
  const now = Date.parse('2026-01-10T12:00:00.000Z');
  const at = (offsetMs: number) => new Date(now - offsetMs).toISOString();

  assert.equal(formatRelativeTime(at(10_000), now), 'now');
  assert.equal(formatRelativeTime(at(5 * 60_000), now), '5m');
  assert.equal(formatRelativeTime(at(3 * 3_600_000), now), '3h');
  assert.equal(formatRelativeTime(at(2 * 86_400_000), now), '2d');
});

test('keeps the web list page size', () => {
  assert.equal(MAX_NOTIFICATION_ITEMS, 30);
});
