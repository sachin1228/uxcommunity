/**
 * Direct-messages client/server shapes.
 *
 * `DmMessage` is deliberately an alias of the community chat's `CachedMessage`:
 * the DM thread renders through the SAME bubble/list primitives (see
 * components/direct-messages), so keeping one message contract is what keeps
 * the two chats visually and behaviourally identical without duplicating the
 * bubble implementation.
 */

import type { CachedMessage } from "@/lib/communities/cache";

/** One DM message — the exact shape MessageBubble / MessageEditModal render. */
export type DmMessage = CachedMessage;

/** The other participant of a conversation, as the list and thread show them. */
export interface DmPeer {
  id: string;
  name: string;
  avatar_url: string | null;
}

/** The last-message preview a conversation row carries. */
export interface DmPreviewMessage {
  id: string;
  content: string | null;
  image_url: string | null;
  created_at: string;
  user_id: string;
  deleted_at: string | null;
  edited_at: string | null;
}

/**
 * The newest reaction event on a conversation, as its list row previews it —
 * the DM counterpart of the community sidebar's `lastReaction`. The row reads
 * "John reacted ❤️ to: \"ok\"", and a later message clears it.
 */
export interface DmLastReaction {
  /** The message that received the reaction. */
  messageId: string;
  /** Who reacted — kept so realtime delete/update events can be matched. */
  reactorId: string;
  emoji: string;
  /** Ordering guard between a fetched payload and later realtime events. */
  createdAt: string;
  /** First name of the reactor ("You" when it is the viewer). */
  firstName: string;
  isOwn: boolean;
  /** Snippet of the reacted message's body, or a "Photo"/"a message" stand-in. */
  messagePreview: string;
  /** Set when the reacted message was an image with no caption. */
  messagePreviewMedia: "image" | null;
}

/** One row of the conversation list (get_dm_conversations). */
export interface DmConversationSummary {
  id: string;
  peer: DmPeer;
  last_message: DmPreviewMessage | null;
  /** Peer messages newer than `my_last_read_at`. */
  unread_count: number;
  my_last_read_at: string | null;
  last_message_at: string | null;
  /** Most recent reaction — previewed instead of the message when set. */
  last_reaction?: DmLastReaction | null;
}
