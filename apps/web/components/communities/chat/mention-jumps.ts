import type { CachedMessage } from "@/lib/communities/cache";

/**
 * Messages that mention the current user and are still awaiting a jump — the
 * feed behind the chat's floating "@" pill, newest first.
 *
 * The mentions live on the message row (`community_messages.mentions`) and ride
 * along with the realtime event, so this reads straight off the loaded window:
 * no notification rows are involved, and a mention that lands while the member
 * has the chat open is pending on the next render.
 *
 * A mention counts as pending when
 *   • the row is not an optimistic `temp-` send,
 *   • it was not written by the current user (the server drops self-mentions),
 *   • its `mentions` list contains the current user, and
 *   • it is newer than the read marker the page loaded with — so a mention the
 *     member has already read never raises the pill, while one that arrived
 *     while they were away does. A missing marker means "never read here":
 *     everything loaded counts.
 *
 * `jumpedIds` holds the mentions already jumped to during this session; they
 * stay out of the queue so the pill does not pop back after the jump.
 */
export function collectPendingMentions(
  messages: readonly CachedMessage[],
  currentUserId: string,
  readCutoff: string | null | undefined,
  jumpedIds: readonly string[] = [],
): CachedMessage[] {
  const cutoff = readCutoff ? Date.parse(readCutoff) : Number.NaN;
  const jumped = new Set(jumpedIds);

  return messages
    .filter((message) => {
      if (message.id.startsWith("temp-")) return false;
      if (message.user_id === currentUserId) return false;
      if (!message.mentions?.some((mention) => mention.user_id === currentUserId)) {
        return false;
      }
      if (Number.isNaN(cutoff)) return true;
      const createdAt = Date.parse(message.created_at);
      return Number.isNaN(createdAt) || createdAt > cutoff;
    })
    .filter((message) => !jumped.has(message.id))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}
