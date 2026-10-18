/**
 * Tests for the home/profile feed poll patching. The screens receive vote
 * events for many communities at once, and the event's `user_vote` belongs to
 * whoever voted — these pin that another member's vote never overwrites the
 * viewer's own choice.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CommunityThread } from './communityContent';
import type { FeedItem } from './homeFeed';
import {
  applyPollEventToFeed,
  applyPollEventToFeedItem,
  feedPollCommunityIds,
  parseThreadPollEvent,
} from './feedPollRealtime';

function threadItem(overrides: Partial<CommunityThread> = {}): FeedItem {
  return {
    id: 'thread-1',
    _type: 'thread',
    community_id: 'community-1',
    user_id: 'author-1',
    title: 'Pick one',
    description: null,
    is_public: false,
    created_at: '2026-10-18T10:00:00.000Z',
    updated_at: '2026-10-18T10:00:00.000Z',
    users: null,
    category: 'question',
    tags: [],
    links: [],
    attachments: [],
    allow_replies: true,
    like_count: 0,
    comment_count: 0,
    user_liked: false,
    user_saved: false,
    poll: { question: 'Pick one', options: ['A', 'B'] },
    poll_vote_counts: [1, 0],
    poll_user_vote: null,
    poll_undo_used: false,
    ...overrides,
  } as FeedItem;
}

test('a valid poll event is parsed', () => {
  assert.deepEqual(
    parseThreadPollEvent({
      event: 'INSERT',
      thread_id: 'thread-1',
      user_id: 'member-2',
      counts: [3, 1],
      user_vote: 0,
      undo_used: false,
    }),
    {
      threadId: 'thread-1',
      userId: 'member-2',
      counts: [3, 1],
      userVote: 0,
      undoUsed: false,
    },
  );
});

test('malformed events are ignored', () => {
  assert.equal(parseThreadPollEvent(null), null);
  assert.equal(parseThreadPollEvent('poll'), null);
  assert.equal(parseThreadPollEvent([]), null);
  assert.equal(parseThreadPollEvent({ thread_id: '', counts: [1] }), null);
  assert.equal(parseThreadPollEvent({ thread_id: 't1', counts: [] }), null);
  assert.equal(parseThreadPollEvent({ thread_id: 't1', counts: [1.5] }), null);
  assert.equal(parseThreadPollEvent({ thread_id: 't1', counts: [-1] }), null);
  assert.equal(parseThreadPollEvent({ thread_id: 't1', counts: ['1'] }), null);
});

test("another member's vote refreshes the tallies but not my choice", () => {
  const item = threadItem({ poll_user_vote: 1, poll_undo_used: true });
  const next = applyPollEventToFeedItem(
    item,
    {
      threadId: 'thread-1',
      userId: 'member-2',
      counts: [4, 2],
      userVote: 0,
      undoUsed: false,
    },
    'me',
  ) as CommunityThread;
  assert.deepEqual(next.poll_vote_counts, [4, 2]);
  assert.equal(next.poll_user_vote, 1);
  assert.equal(next.poll_undo_used, true);
});

test('my own vote from another device replaces my choice', () => {
  const item = threadItem({ poll_user_vote: 1 });
  const next = applyPollEventToFeedItem(
    item,
    {
      threadId: 'thread-1',
      userId: 'me',
      counts: [3, 2],
      userVote: 0,
      undoUsed: false,
    },
    'me',
  ) as CommunityThread;
  assert.deepEqual(next.poll_vote_counts, [3, 2]);
  assert.equal(next.poll_user_vote, 0);
  assert.equal(next.poll_undo_used, false);
});

test('an undo from another device clears my choice', () => {
  const item = threadItem({ poll_user_vote: 0 });
  const next = applyPollEventToFeedItem(
    item,
    {
      threadId: 'thread-1',
      userId: 'me',
      counts: [1, 1],
      userVote: null,
      undoUsed: true,
    },
    'me',
  ) as CommunityThread;
  assert.equal(next.poll_user_vote, null);
  assert.equal(next.poll_undo_used, true);
});

test('the event only touches its own thread', () => {
  const item = threadItem();
  const same = applyPollEventToFeedItem(
    item,
    { threadId: 'other', userId: 'me', counts: [1], userVote: 0, undoUsed: false },
    'me',
  );
  assert.equal(same, item);

  const items = [item];
  const unchanged = applyPollEventToFeed(
    items,
    { threadId: 'other', userId: 'me', counts: [1], userVote: 0, undoUsed: false },
    'me',
  );
  assert.equal(unchanged, items);
});

test('the feed patches the matching row in place', () => {
  const first = threadItem({ id: 'thread-1' });
  const second = threadItem({ id: 'thread-2', community_id: 'community-2' });
  const next = applyPollEventToFeed(
    [first, second],
    { threadId: 'thread-2', userId: 'member-2', counts: [2, 2], userVote: null, undoUsed: false },
    'me',
  );
  assert.equal(next[0], first);
  assert.deepEqual((next[1] as CommunityThread).poll_vote_counts, [2, 2]);
});

test('only poll-bearing threads contribute communities to subscribe to', () => {
  const items: FeedItem[] = [
    threadItem({ id: 'one', community_id: 'community-1' }),
    threadItem({ id: 'two', community_id: 'community-1' }),
    threadItem({ id: 'three', community_id: 'community-2', poll: null }),
    threadItem({ id: 'four', community_id: 'community-3' }),
    {
      ...threadItem({ id: 'event-1', community_id: 'community-4' }),
      _type: 'event',
    } as FeedItem,
  ];
  assert.deepEqual(feedPollCommunityIds(items), ['community-1', 'community-3']);
});
