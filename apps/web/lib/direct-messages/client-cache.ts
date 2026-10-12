/**
 * Client-side DM caches.
 *
 * Module-level (not React state) so the messages page can un-mount and
 * re-mount — navigating to another dashboard page and back — without losing
 * its snapshots: on remount the list and open thread render instantly from
 * here while a background fetch catches up. Mirrors the community chat's
 * msgCache/metaCache idea, minus the sidebar projection (nothing else reads
 * DM data).
 *
 * Purely a cache: every consumer keeps its own React state and mirrors
 * changes back into this module, exactly like CommunityChat does with
 * msgCache.
 */

import type { DmConversationSummary, DmMessage, DmPreviewMessage } from "./types";

const MAX_CACHED_CONVERSATIONS = 30;

let conversations: DmConversationSummary[] | null = null;
const messages = new Map<string, DmMessage[]>();
const fetchedAt = new Map<string, number>();

function evictIfNeeded(): void {
  while (messages.size > MAX_CACHED_CONVERSATIONS) {
    const oldest = fetchedAt.entries().next().value as [string, number] | undefined;
    if (!oldest) break;
    messages.delete(oldest[0]);
    fetchedAt.delete(oldest[0]);
  }
}

export const dmCache = {
  getConversations(): DmConversationSummary[] | null {
    return conversations;
  },

  setConversations(next: DmConversationSummary[]): void {
    conversations = next;
  },

  patchConversation(
    conversationId: string,
    patch: (current: DmConversationSummary) => DmConversationSummary,
  ): void {
    if (!conversations) return;
    conversations = conversations.map((conversation) =>
      conversation.id === conversationId ? patch(conversation) : conversation,
    );
  },

  getMessages(conversationId: string): DmMessage[] | undefined {
    return messages.get(conversationId);
  },

  setMessages(conversationId: string, next: DmMessage[]): void {
    messages.delete(conversationId);
    messages.set(conversationId, next);
    fetchedAt.delete(conversationId);
    fetchedAt.set(conversationId, Date.now());
    evictIfNeeded();
  },

  getFetchedAt(conversationId: string): number | undefined {
    return fetchedAt.get(conversationId);
  },
};

/**
 * Fold a live message into the conversation list: the conversation jumps to
 * the top with the new preview and its unread count moves for the receiving
 * side (a message from the viewer only refreshes the preview).
 *
 * Returns the same array identity when the conversation is not in the list —
 * the caller then refetches the list, because this client has never seen the
 * peer's identity (first message of a brand-new conversation elsewhere).
 */
export function bumpConversationWithMessage(
  current: DmConversationSummary[],
  args: {
    conversationId: string;
    viewerId: string;
    message: DmPreviewMessage;
    /** True while the viewer has that conversation open and the tab visible. */
    activelyReading: boolean;
  },
): DmConversationSummary[] {
  const index = current.findIndex((c) => c.id === args.conversationId);
  if (index === -1) return current;

  const conversation = current[index];
  const isOwnMessage = args.message.user_id === args.viewerId;
  const bumped: DmConversationSummary = {
    ...conversation,
    last_message: args.message,
    last_message_at: args.message.created_at,
    unread_count:
      isOwnMessage || args.activelyReading
        ? conversation.unread_count
        : conversation.unread_count + 1,
  };
  return [bumped, ...current.filter((c) => c.id !== args.conversationId)];
}

/**
 * Patch the conversation's preview when its last message is edited or
 * deleted (the list row mirrors the newest message; older rows are not in
 * the list's payload at all).
 */
export function patchConversationPreview(
  current: DmConversationSummary[],
  args: {
    conversationId: string;
    messageId: string;
    patch: Partial<DmPreviewMessage>;
    /** True when the row keeps its place (edit) — false clears it (tombstone keeps content wiped). */
  },
): DmConversationSummary[] {
  const index = current.findIndex((c) => c.id === args.conversationId);
  if (index === -1) return current;
  const conversation = current[index];
  if (conversation.last_message?.id !== args.messageId) return current;

  const next = current.slice();
  next[index] = {
    ...conversation,
    last_message: { ...conversation.last_message, ...args.patch },
  };
  return next;
}
