/**
 * Pure filter behind the DM conversation list's search box.
 *
 * The community sidebar carries no search; this pane does, so the rule lives in
 * its own module to stay unit-testable, exactly like `preview-text`. Matching is
 * on the peer's name only: a row is identified by who it is with, so every hit
 * is explainable at a glance. Bodies would need a server query — the list only
 * carries each conversation's newest message.
 */

import type { DmConversationSummary } from "./types";

/**
 * The peer-name filter for the search box: case- and whitespace-insensitive
 * substring match. An empty query returns the list untouched (same reference,
 * so an idle pane keeps its rows memoised).
 */
export function filterConversations(
  conversations: DmConversationSummary[],
  query: string,
): DmConversationSummary[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return conversations;
  return conversations.filter((conversation) =>
    conversation.peer.name.toLowerCase().includes(needle),
  );
}
