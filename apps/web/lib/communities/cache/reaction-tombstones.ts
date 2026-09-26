const REACTION_TOMBSTONE_TTL_MS = 5 * 60_000;
const MAX_REACTION_TOMBSTONES   = 250;

/**
 * Local reaction removals, keyed `${communityId}:${messageId}`, so an older
 * still-pending Realtime lookup cannot restore a reaction the user just removed.
 */
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

/** A fresh local reaction supersedes any earlier removal of the same target. */
export function clearSidebarReactionTombstone(communityId: string, messageId: string): void {
  removedSidebarReactions.delete(sidebarReactionKey(communityId, messageId));
}

export function clearCommunityReactionTombstones(communityId: string): void {
  for (const key of removedSidebarReactions.keys()) {
    if (key.startsWith(`${communityId}:`)) removedSidebarReactions.delete(key);
  }
}

export function clearAllReactionTombstones(): void {
  removedSidebarReactions.clear();
}
