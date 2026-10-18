/**
 * Home / profile feed poll realtime helpers.
 *
 * The community tab can refetch its one query on a poll event, but the home,
 * profile and member feeds keep their own arrays and mix communities. These
 * helpers validate the event and patch the matching thread in place, so a vote
 * anywhere moves the visible tallies without refetching the feed. The realtime
 * hook in `hooks/useThreadPollRealtime.ts` handles the subscriptions.
 */

import type { CommunityThread } from './communityContent';
import type { FeedItem } from './homeFeed';

/** One poll event from the threads room's `poll` topic. */
export interface ThreadPollEvent {
  threadId: string;
  /** The member whose vote/undo produced the event. */
  userId: string | null;
  /** Server-confirmed totals, aligned with the poll's options. */
  counts: number[];
  /** That member's vote after the write (null after an undo). */
  userVote: number | null;
  undoUsed: boolean;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Validate a raw realtime payload, or null when it is not a poll event. */
export function parseThreadPollEvent(data: unknown): ThreadPollEvent | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const record = data as {
    thread_id?: unknown;
    user_id?: unknown;
    counts?: unknown;
    user_vote?: unknown;
    undo_used?: unknown;
  };
  if (typeof record.thread_id !== 'string' || !record.thread_id) return null;
  if (!Array.isArray(record.counts) || record.counts.length === 0) return null;
  if (!record.counts.every(isCount)) return null;
  return {
    threadId: record.thread_id,
    userId: typeof record.user_id === 'string' && record.user_id ? record.user_id : null,
    counts: record.counts,
    userVote:
      typeof record.user_vote === 'number' && Number.isInteger(record.user_vote)
        ? record.user_vote
        : null,
    undoUsed: record.undo_used === true,
  };
}

/**
 * Patch one feed row with a poll event.
 *
 * The event's `user_vote` belongs to the member who acted, so it only replaces
 * the viewer's vote when that member *is* the viewer (a second device). Another
 * member's vote refreshes only the tallies, leaving the viewer's choice and
 * one-time undo untouched.
 */
export function applyPollEventToFeedItem(
  item: FeedItem,
  event: ThreadPollEvent,
  currentUserId: string,
): FeedItem {
  if (item._type !== 'thread' || item.id !== event.threadId) return item;
  const thread = item as CommunityThread;
  const mine = event.userId !== null && event.userId === currentUserId;
  return {
    ...thread,
    poll_vote_counts: event.counts,
    poll_user_vote: mine ? event.userVote : thread.poll_user_vote,
    poll_undo_used: mine ? event.undoUsed : thread.poll_undo_used,
  } as FeedItem;
}

/** Patch every matching row; returns the same array when nothing matched. */
export function applyPollEventToFeed(
  items: FeedItem[],
  event: ThreadPollEvent,
  currentUserId: string,
): FeedItem[] {
  let changed = false;
  const next = items.map((item) => {
    const updated = applyPollEventToFeedItem(item, event, currentUserId);
    if (updated !== item) changed = true;
    return updated;
  });
  return changed ? next : items;
}

/**
 * The communities whose threads room this feed needs to listen to: only those
 * with a poll-bearing thread currently visible, de-duplicated. Plain posts
 * need no subscription.
 */
export function feedPollCommunityIds(items: FeedItem[]): string[] {
  const ids = new Set<string>();
  for (const item of items) {
    if (item._type !== 'thread') continue;
    const thread = item as CommunityThread;
    if (thread.poll && item.community_id) ids.add(item.community_id);
  }
  return [...ids];
}
