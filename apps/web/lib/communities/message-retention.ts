/**
 * The community chat retention window — how long a chat message survives
 * before it is deleted for everyone.
 *
 * This module is deliberately client-safe (no `server-only`): the chat
 * window's system notice prints the number, the realtime handler uses the
 * cutoff helper to prune expired messages from its cache, and the server-side
 * sweep (message-retention-sweep.ts) deletes rows past the same cutoff. One
 * constant feeds all three so the notice can never promise a different window
 * than the sweep enforces. The same window bounds the timeline's "created a …"
 * cards (chatTimelineVisibleSince), which are read from their own tables and
 * are never deleted themselves.
 */

export const CHAT_MESSAGE_RETENTION_DAYS = 15;

export const CHAT_MESSAGE_RETENTION_MS =
  CHAT_MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000;

/** ISO timestamp of the oldest message the chat still keeps, as of `nowMs`. */
export function chatRetentionCutoffIso(nowMs: number = Date.now()): string {
  return new Date(nowMs - CHAT_MESSAGE_RETENTION_MS).toISOString();
}

/** Serialize a PostgREST timestamptz, or null when it is missing/unparseable. */
function toTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * The oldest chat-timeline item a member may see, as an ISO timestamp.
 *
 * The community chat timeline holds two kinds of rows: messages and the
 * permanent "John created a thread / resource / event / showcase post" cards.
 * Both obey the same two rules:
 *
 *   * the member's own history start — the moment they joined the room (or
 *     last cleared their copy of it), so a new member opens the chat on the
 *     conversation as it is now instead of a backlog of older notification
 *     cards;
 *   * the retention window — the disappearing-messages promise applies to the
 *     cards too, so a "created a …" card ages out of the chat with its window
 *     while the thread/post/resource/event itself is untouched.
 *
 * The later of the two wins. The message page already filters by the join
 * point (get_community_message_page's p_history_start) and the sweep deletes
 * past the window; this helper is what the content-card read has to apply
 * itself, because those rows live in their own tables and are never deleted.
 */
export function chatTimelineVisibleSince(
  membership: {
    joined_at?: string | null;
    history_cleared_at?: string | null;
  },
  nowMs: number = Date.now(),
): string {
  const retentionCutoffMs = nowMs - CHAT_MESSAGE_RETENTION_MS;
  const joinedMs = toTime(membership.joined_at);
  const clearedMs = toTime(membership.history_cleared_at);
  const historyStartMs = Math.max(
    joinedMs ?? Number.NEGATIVE_INFINITY,
    clearedMs ?? Number.NEGATIVE_INFINITY,
  );
  const sinceMs = Number.isFinite(historyStartMs)
    ? Math.max(historyStartMs, retentionCutoffMs)
    : retentionCutoffMs;
  return new Date(sinceMs).toISOString();
}
