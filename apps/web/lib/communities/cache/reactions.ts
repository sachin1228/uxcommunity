/**
 * Reaction state held on the client: the pure group reducers and the local
 * "removed" tombstones.
 *
 * WHY THIS EXISTS
 *   A reaction is applied optimistically and then confirmed by a realtime event
 *   that may arrive late. The reducers are pure and the tombstones are the only
 *   state, which is a small ownership of its own: it used to be mixed into the
 *   same module as the community/sidebar/explore caches, so the rules for
 *   ignoring a stale echo sat next to unrelated cache invalidation.
 *
 *   The tombstones are keyed by `communityId:messageId` and are bounded by both
 *   an age (`REACTION_TOMBSTONE_TTL_MS`) and a size, because they are written per
 *   optimistic action. They are dropped with the community they belong to (see
 *   `evictCommunityState`) and with the session.
 *
 * These are used by the sidebar preview patch (`patchSidebarReaction` in
 * ./sidebar-store.ts) and by the chat's own reaction handler; nothing here
 * imports a store, and nothing here talks to the network.
 */

import type { MessageReaction } from "./types";

const REACTION_TOMBSTONE_TTL_MS = 5 * 60_000;
const MAX_REACTION_TOMBSTONES   = 250;

const removedSidebarReactions = new Map<string, number>();

function sidebarReactionKey(communityId: string, messageId: string): string {
  return `${communityId}:${messageId}`;
}

/** Marks a local removal so an older, still-pending Realtime lookup cannot restore it. */
export function markSidebarReactionRemoved(
  communityId: string,
  messageId: string,
): void {
  const now = Date.now();
  for (const [key, removedAt] of removedSidebarReactions) {
    if (now - removedAt > REACTION_TOMBSTONE_TTL_MS) {
      removedSidebarReactions.delete(key);
    }
  }
  while (removedSidebarReactions.size >= MAX_REACTION_TOMBSTONES) {
    const oldest = removedSidebarReactions.keys().next().value;
    if (!oldest) break;
    removedSidebarReactions.delete(oldest);
  }
  removedSidebarReactions.set(sidebarReactionKey(communityId, messageId), now);
}

/** Returns true when a Realtime reaction predates the latest local removal. */
export function isSidebarReactionStale(
  communityId: string,
  messageId: string,
  createdAt?: string,
): boolean {
  const removedAt = removedSidebarReactions.get(
    sidebarReactionKey(communityId, messageId),
  );
  if (!removedAt) return false;

  const reactionTime = createdAt ? Date.parse(createdAt) : Number.NaN;
  return Number.isNaN(reactionTime) || reactionTime <= removedAt;
}

/** Forget every tombstone belonging to one community (left, deleted, archived). */
export function clearReactionTombstonesForCommunity(communityId: string): void {
  for (const key of removedSidebarReactions.keys()) {
    if (key.startsWith(`${communityId}:`)) removedSidebarReactions.delete(key);
  }
}

/** Drop every tombstone (session change — see clearAllUserCaches). */
export function clearReactionTombstones(): void {
  removedSidebarReactions.clear();
}

/** Remove a tombstone because a newer reaction superseded it. */
export function clearReactionTombstone(communityId: string, messageId: string): void {
  removedSidebarReactions.delete(sidebarReactionKey(communityId, messageId));
}

export function applyReactionInsert(
  reactions: MessageReaction[],
  emoji: string,
  userId: string,
): MessageReaction[] {
  const without = reactions.map((r) => ({
    ...r,
    user_ids: r.user_ids.filter((uid) => uid !== userId),
  })).filter((r) => r.user_ids.length > 0);

  const existing = without.find((r) => r.emoji === emoji);
  if (existing) {
    return without.map((r) =>
      r.emoji === emoji ? { ...r, user_ids: [...r.user_ids, userId] } : r
    );
  }
  return [...without, { emoji, user_ids: [userId] }];
}

export function applyReactionDelete(
  reactions: MessageReaction[],
  emoji: string,
  userId: string,
): MessageReaction[] {
  return reactions
    .map((r) =>
      r.emoji === emoji
        ? { ...r, user_ids: r.user_ids.filter((uid) => uid !== userId) }
        : r
    )
    .filter((r) => r.user_ids.length > 0);
}
