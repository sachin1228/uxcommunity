import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routeForPush } from './pushRoutes';

test('community message opens its chat', () => {
  assert.deepEqual(
    routeForPush({ type: 'community_message', communityId: 'c-1', messageId: 'm-1' }),
    { pathname: '/community/[id]', params: { id: 'c-1' } },
  );
});

test('DM opens the conversation', () => {
  assert.deepEqual(
    routeForPush({ type: 'dm_message', conversationId: 'dm-1', messageId: 'm-1' }),
    { pathname: '/messages/[id]', params: { id: 'dm-1' } },
  );
});

test('activity opens the notifications list', () => {
  assert.equal(
    routeForPush({
      type: 'app_notification',
      notificationId: 'n-1',
      notificationType: 'thread_like',
      href: '/dashboard/communities/c/threads/t',
    }),
    '/notifications',
  );
});

test('event lifecycle opens its room, or the feed without one', () => {
  assert.deepEqual(
    routeForPush({
      type: 'event_lifecycle',
      stage: 'live',
      eventId: 'e-1',
      communityId: 'c-1',
    }),
    { pathname: '/community/[id]', params: { id: 'c-1' } },
  );
  assert.equal(
    routeForPush({ type: 'event_lifecycle', stage: 'ended', eventId: 'e-1' }),
    '/(tabs)',
  );
});
