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

/** One row of the conversation list (get_dm_conversations). */
export interface DmConversationSummary {
  id: string;
  peer: DmPeer;
  last_message: DmPreviewMessage | null;
  /** Peer messages newer than `my_last_read_at`. */
  unread_count: number;
  my_last_read_at: string | null;
  last_message_at: string | null;
}

/** A person pickable in the "new message" search. */
export interface DmPerson {
  id: string;
  name: string;
  avatar_url: string | null;
}
