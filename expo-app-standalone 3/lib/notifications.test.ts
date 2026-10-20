/**
 * Tests for the notifications model — the web's tab rules, the bell's seen
 * watermark, and the href → route walk. Ported expectations from the web's
 * lib/notifications-tabs.test.ts and lib/notifications-seen.test.ts, plus the
 * mobile-only route mapper (the piece notificationsClient leans on when a row
 * is tapped).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  countUnseenSince,
  createSeenStore,
  newestCreatedAt,
  NOTIFICATION_TABS,
  notificationHrefToRoute,
  notificationSeenStorageKey,
  notificationTabFor,
  splitNotificationsByTab,
  type NotificationItem,
  type NotificationType,
} from './notifications';

function item(overrides: Partial<NotificationItem> & { id: string }): NotificationItem {
  return {
    user_id: 'u-1',
    type: 'thread_like',
    title: 'A title',
    body: null,
    href: '/dashboard/notifications',
    read_at: null,
    created_at: '2026-10-17T00:00:00.000Z',
    ...overrides,
  };
}

/** A recording in-memory storage standing in for AsyncStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (key: string) => data.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

test('every tab the web declares renders under the tab it names', () => {
  assert.deepEqual(
    NOTIFICATION_TABS.map((entry) => entry.key),
    ['activity', 'events', 'jobs', 'other'],
  );
  assert.equal(notificationTabFor('thread_like'), 'activity');
  assert.equal(notificationTabFor('resource_reply'), 'activity');
  assert.equal(notificationTabFor('event_rsvp'), 'events');
  assert.equal(notificationTabFor('event_reminder'), 'events');
  assert.equal(notificationTabFor('event_live'), 'events');
  assert.equal(notificationTabFor('event_ended'), 'events');
  assert.equal(notificationTabFor('job_match'), 'jobs');
  assert.equal(notificationTabFor('thread_deleted'), 'other');
  assert.equal(notificationTabFor('join_request_accepted'), 'other');
});

test('split keeps order, counts unread per tab and drops unclaimed types', () => {
  const items = [
    item({ id: 'a', type: 'thread_like', created_at: '2026-10-17T03:00:00.000Z' }),
    item({ id: 'b', type: 'thread_comment', read_at: '2026-10-17T01:00:00.000Z' }),
    item({ id: 'c', type: 'event_rsvp' }),
    item({ id: 'd', type: 'job_match' }),
    item({ id: 'e', type: 'report_reviewed' }),
    // A type no tab claims yet — invisible rather than leaking into `other`.
    item({ id: 'f', type: 'community_thread' as NotificationType }),
  ];

  const { activity, events, jobs, other, unreadByTab } = splitNotificationsByTab(items);

  assert.deepEqual(
    activity.map((row) => row.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    events.map((row) => row.id),
    ['c'],
  );
  assert.deepEqual(
    jobs.map((row) => row.id),
    ['d'],
  );
  assert.deepEqual(
    other.map((row) => row.id),
    ['e'],
  );
  assert.deepEqual(unreadByTab, { activity: 1, events: 1, jobs: 1, other: 1 });
});

test('the seen watermark hydrates once, advances monotonically and persists', async () => {
  const userId = 'u-1';
  const key = notificationSeenStorageKey(userId);
  const storage = fakeStorage({ [key]: '2026-10-16T10:00:00.000Z' });
  const store = createSeenStore(storage);

  // Nothing is known before hydration — never anchor on this.
  assert.equal(store.read(userId), undefined);

  await store.hydrate(userId);
  assert.equal(store.read(userId), '2026-10-16T10:00:00.000Z');

  assert.equal(store.advance(userId, '2026-10-17T09:00:00.000Z'), true);
  assert.equal(store.read(userId), '2026-10-17T09:00:00.000Z');
  assert.equal(storage.data.get(key), '2026-10-17T09:00:00.000Z');

  // Older news never moves it backwards.
  assert.equal(store.advance(userId, '2026-10-17T08:00:00.000Z'), false);
  assert.equal(store.read(userId), '2026-10-17T09:00:00.000Z');
});

test('an advance ahead of hydration survives a late storage read', async () => {
  const userId = 'u-1';
  const key = notificationSeenStorageKey(userId);
  const storage = fakeStorage({ [key]: '2026-10-16T10:00:00.000Z' });
  const store = createSeenStore(storage);

  // The list loaded and advanced before the badge ever hydrated.
  store.advance(userId, '2026-10-17T09:00:00.000Z');
  await store.hydrate(userId);

  assert.equal(store.read(userId), '2026-10-17T09:00:00.000Z');
});

test('a member who never opened the list has no watermark at all', async () => {
  const store = createSeenStore(fakeStorage());
  await store.hydrate('u-1');
  assert.equal(store.read('u-1'), null);
});

test('unseen counts only unread rows newer than the watermark', () => {
  const watermark = '2026-10-17T00:00:00.000Z';
  const items = [
    item({ id: 'a', created_at: '2026-10-17T01:00:00.000Z' }),
    item({ id: 'b', created_at: '2026-10-16T23:00:00.000Z' }),
    item({ id: 'c', created_at: '2026-10-17T02:00:00.000Z', read_at: '2026-10-17T02:30:00.000Z' }),
  ];

  assert.equal(countUnseenSince(items, watermark), 1);
  assert.equal(newestCreatedAt(items), '2026-10-17T02:00:00.000Z');
  assert.equal(newestCreatedAt([]), null);
});

test("a notification's href walks to the app route that can open it", () => {
  assert.deepEqual(notificationHrefToRoute('/dashboard/communities/c-1'), {
    kind: 'community',
    communityId: 'c-1',
  });
  assert.deepEqual(notificationHrefToRoute('/dashboard/communities/c-1/threads/t-1'), {
    kind: 'community',
    communityId: 'c-1',
    contentKind: 'threads',
    contentId: 't-1',
  });
  assert.deepEqual(notificationHrefToRoute('/dashboard/communities/c-1/showcase/s-1'), {
    kind: 'community',
    communityId: 'c-1',
    contentKind: 'showcase',
    contentId: 's-1',
  });
  assert.deepEqual(notificationHrefToRoute('/dashboard/communities/c-1/resources/r-1'), {
    kind: 'community',
    communityId: 'c-1',
    contentKind: 'resources',
    contentId: 'r-1',
  });
  assert.deepEqual(notificationHrefToRoute('/dashboard/communities/c-1/events/e-1'), {
    kind: 'community',
    communityId: 'c-1',
    contentKind: 'events',
    contentId: 'e-1',
  });
  assert.deepEqual(notificationHrefToRoute('/dashboard/jobs/j-1'), { kind: 'jobs' });
  assert.deepEqual(notificationHrefToRoute('/dashboard/events/e-1'), { kind: 'events' });
});

test('an href the app cannot open is left alone', () => {
  // The fallback a report outcome uses when its community is gone.
  assert.deepEqual(notificationHrefToRoute('/dashboard/notifications'), { kind: 'none' });
  // An unknown section inside a community still opens the community.
  assert.deepEqual(notificationHrefToRoute('/dashboard/communities/c-1/members/m-1'), {
    kind: 'community',
    communityId: 'c-1',
  });
  // Absolute URLs and query strings are tolerated.
  assert.deepEqual(
    notificationHrefToRoute('https://app.example.com/dashboard/communities/c-1/threads/t-1?from=push'),
    { kind: 'community', communityId: 'c-1', contentKind: 'threads', contentId: 't-1' },
  );
  assert.deepEqual(notificationHrefToRoute(''), { kind: 'none' });
  assert.deepEqual(notificationHrefToRoute('/settings/profile'), { kind: 'none' });
});
