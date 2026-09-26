import {
  patchSidebarLastMessage,
  restoreSidebarEntry,
  sidebarStore,
  type CachedMessage,
  type CachedSidebarCommunity,
  type MessageMention,
  type ReplyPreview,
} from "@/lib/communities/cache";
import { scrollChatToBottom } from "../chatUtils";
import type { SendContext } from "./types";

export function buildOptimisticMessage(
  ctx: SendContext,
  fields: {
    tempId: string;
    content: string;
    replyTo: ReplyPreview | null;
    imageUrl: string | null;
    mentions: MessageMention[];
  },
): CachedMessage {
  return {
    id: fields.tempId,
    content: fields.content,
    created_at: new Date().toISOString(),
    user_id: ctx.currentUserId,
    users: { name: ctx.currentUserName, avatar_url: ctx.currentUserAvatar },
    status: "sending",
    reactions: [],
    reply_to: fields.replyTo ?? null,
    image_url: fields.imageUrl,
    mentions: fields.mentions,
  };
}

/**
 * Bump the community to the top of the sidebar instantly. The chat shows the
 * optimistic bubble already, and the sidebar shouldn't wait for the Realtime
 * echo (DB insert → fan-out → WebSocket round trip) to reflect the sender's own
 * message. The echo replaces this preview when it lands.
 *
 * Returns a rollback that restores the previous entry on failure.
 */
export function bumpSidebarPreview(
  communityId: string,
  lastMessage: NonNullable<CachedSidebarCommunity["last_message"]>,
): () => void {
  const tempId = lastMessage.id;
  const prevSidebarEntry =
    sidebarStore.data?.communities.find((c) => c.id === communityId) ?? null;
  patchSidebarLastMessage(communityId, lastMessage);

  return () => {
    if (!prevSidebarEntry) return;
    const current = sidebarStore.data?.communities.find((c) => c.id === communityId);
    // Only restore when our optimistic preview is still the newest entry —
    // never clobber a message that arrived after the failed send.
    if (!current || current.last_message?.id !== tempId) return;
    restoreSidebarEntry(communityId, prevSidebarEntry);
  };
}

/**
 * Always jump to the bottom: the message just sent is the newest row, so it is
 * what the user expects to see — even when they sent it while scrolled up
 * reading older history. Running in a rAF puts the jump after the optimistic
 * bubble has been committed and laid out, so `scrollHeight` already includes it.
 */
export function scrollToNewest(ctx: SendContext): void {
  requestAnimationFrame(() => scrollChatToBottom(ctx.scrollContainerRef.current));
}
