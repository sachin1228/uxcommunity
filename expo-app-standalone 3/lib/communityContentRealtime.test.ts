import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyContentRealtimeEvent,
  needsContentRevalidation,
} from './communityContentRealtime';
import type {
  CommunityEvent,
  CommunityResource,
  CommunityThread,
} from './communityContent';

const ME = 'me';

function thread(overrides: Partial<CommunityThread> = {}): CommunityThread {
  return {
    id: 't1',
    community_id: 'c1',
    user_id: 'author',
    title: 'Thread',
    description: null,
    is_public: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    users: null,
    category: 'discussion',
    tags: [],
    links: [],
    attachments: [],
    allow_replies: true,
    like_count: 3,
    comment_count: 0,
    user_liked: false,
    user_saved: false,
    poll: { question: 'Q', options: ['A', 'B'] } as CommunityThread['poll'],
    poll_vote_counts: [1, 2],
    poll_user_vote: null,
    poll_undo_used: false,
    ...overrides,
  };
}

function event(overrides: Partial<CommunityEvent> = {}): CommunityEvent {
  return {
    id: 'e1',
    community_id: 'c1',
    user_id: 'author',
    title: 'Event',
    description: null,
    is_public: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    users: null,
    event_date: '2026-02-01T10:00:00Z',
    end_date: null,
    host_timezone: null,
    is_online: false,
    location: null,
    meet_link: null,
    max_attendees: null,
    cover_image_url: null,
    rsvp_count: 4,
    like_count: 2,
    save_count: 1,
    user_rsvped: false,
    user_liked: false,
    user_saved: false,
    ...overrides,
  };
}

function resource(overrides: Partial<CommunityResource> = {}): CommunityResource {
  return {
    id: 'r1',
    community_id: 'c1',
    user_id: 'author',
    title: 'Resource',
    description: null,
    is_public: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    users: null,
    resource_type: 'article',
    url: 'https://example.com',
    tags: [],
    save_count: 5,
    comment_count: 0,
    bookmark_count: 2,
    user_saved: false,
    user_bookmarked: false,
    ...overrides,
  };
}

test('a thread like updates only the affected row and needs no refetch', () => {
  const items = [thread(), thread({ id: 't2', like_count: 1 })];
  const result = applyContentRealtimeEvent(
    'threads',
    items,
    'like',
    { event: 'INSERT', thread_id: 't1', user_id: 'someone-else' },
    ME,
  );

  assert.equal(result.handled, true, 'the payload is complete — no fallback fetch');
  assert.equal(
    needsContentRevalidation(result),
    false,
    'one like must not trigger a full-list refetch',
  );
  assert.equal(result.changed, true);
  assert.equal(result.items[0].like_count, 4);
  assert.equal(result.items[1].like_count, 1, 'an unrelated row is untouched');
});

test('own like/poll/save/rsvp echoes never double-count the mutation response', () => {
  const threadLike = applyContentRealtimeEvent(
    'threads',
    [thread()],
    'like',
    { event: 'INSERT', thread_id: 't1', user_id: ME },
    ME,
  );
  assert.equal(threadLike.handled, true);
  assert.equal(threadLike.changed, false, 'the card already applied the POST result');

  const eventLike = applyContentRealtimeEvent(
    'events',
    [event()],
    'like',
    { event: 'INSERT', event_id: 'e1', user_id: ME },
    ME,
  );
  assert.equal(eventLike.handled, true);
  assert.equal(eventLike.changed, false);

  const resourceSave = applyContentRealtimeEvent(
    'resources',
    [resource()],
    'save',
    { event: 'INSERT', resource_id: 'r1', user_id: ME },
    ME,
  );
  assert.equal(resourceSave.handled, true);
  assert.equal(resourceSave.changed, false);
});

test('a poll event applies the server counts and the viewer vote in place', () => {
  const result = applyContentRealtimeEvent(
    'threads',
    [thread()],
    'poll',
    {
      event: 'INSERT',
      thread_id: 't1',
      user_id: ME,
      counts: [2, 3],
      user_vote: 1,
      undo_used: false,
    },
    ME,
  );

  assert.equal(result.handled, true);
  assert.deepEqual(result.items[0].poll_vote_counts, [2, 3]);
  assert.equal(result.items[0].poll_user_vote, 1);
});

test('event RSVP and save patches are applied locally', () => {
  const rsvp = applyContentRealtimeEvent(
    'events',
    [event()],
    'rsvp',
    { event: 'INSERT', event_id: 'e1', user_id: 'someone-else' },
    ME,
  );
  assert.equal(rsvp.handled, true);
  assert.equal(rsvp.items[0].rsvp_count, 5);

  const save = applyContentRealtimeEvent(
    'events',
    [event()],
    'save',
    { event: 'DELETE', event_id: 'e1', user_id: 'someone-else' },
    ME,
  );
  assert.equal(save.handled, true);
  assert.equal(save.items[0].save_count, 0);
});

test('a resource save event patches the heart count without a refetch', () => {
  const result = applyContentRealtimeEvent(
    'resources',
    [resource()],
    'save',
    { event: 'DELETE', resource_id: 'r1', user_id: 'someone-else' },
    ME,
  );

  assert.equal(result.handled, true);
  assert.equal(result.items[0].save_count, 4);
});

test('incomplete interaction payloads ask for a safe revalidation', () => {
  // Old event-like/save publishers had no INSERT/DELETE marker. Guessing the
  // direction would corrupt the count, so the hook must refetch instead.
  const missingMarker = applyContentRealtimeEvent(
    'events',
    [event()],
    'like',
    { event_id: 'e1', user_id: 'someone-else' },
    ME,
  );
  assert.equal(missingMarker.handled, false);

  const missingId = applyContentRealtimeEvent(
    'threads',
    [thread()],
    'like',
    { event: 'INSERT', user_id: 'someone-else' },
    ME,
  );
  assert.equal(missingId.handled, false);

  const malformedCounts = applyContentRealtimeEvent(
    'threads',
    [thread()],
    'poll',
    { thread_id: 't1', counts: ['nope'] },
    ME,
  );
  assert.equal(malformedCounts.handled, false);
});

test('structural changes and unknown topics still revalidate', () => {
  assert.equal(
    applyContentRealtimeEvent('threads', [thread()], 'thread', { id: 't1' }, ME).handled,
    false,
    'create/update/delete may change membership and ordering',
  );
  assert.equal(
    applyContentRealtimeEvent('events', [event()], 'event', { id: 'e1' }, ME).handled,
    false,
  );
  assert.equal(
    applyContentRealtimeEvent('resources', [resource()], 'resource', { id: 'r1' }, ME).handled,
    false,
  );
});
