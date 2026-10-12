/**
 * Pure preview-line formatting for the DM conversation list.
 *
 * The community sidebar keeps this logic in `sidebar-content.ts`; the DM row
 * needs the same two shapes — the message preview ("You: hi", "Photo") and the
 * reaction preview ("\"ok\"") — but off `DmPreviewMessage` rather than the
 * community's cached message, hence its own module. Kept pure so both the
 * server projection and the row render from one contract.
 */

import type { DmPreviewMessage } from "./types";

/** Longest reacted-message snippet the reaction preview quotes. */
const REACTION_QUOTE_CHARS = 40;

export interface ReactionPreviewSource {
  content: string | null;
  hasImage: boolean;
}

/**
 * The snippet a reaction preview shows for the message that was reacted to:
 * the quoted body, or a stand-in when there is no text. `media` is set when
 * the stand-in *is* the fact (an image-only message) so the row can draw the
 * photo glyph before the word instead of a camera emoji.
 */
export function reactionPreviewText(
  source: ReactionPreviewSource | null,
): { text: string; media: "image" | null } {
  if (source?.content) {
    const quote = source.content.slice(0, REACTION_QUOTE_CHARS);
    return {
      text: `"${quote}${source.content.length > REACTION_QUOTE_CHARS ? "…" : ""}"`,
      media: null,
    };
  }
  if (source?.hasImage) return { text: "Photo", media: "image" };
  return { text: "a message", media: null };
}

export interface MessagePreview {
  /** "You" for the viewer's own message, else null (the row already names the peer). */
  prefix: string | null;
  text: string;
  /** Set when the message is an image with no caption; the row draws the glyph. */
  media: "image" | null;
  deleted: boolean;
}

/**
 * The preview line for a conversation's newest message. An image-only message
 * is returned as its own fact (`media`) rather than as a camera emoji inside
 * `text`, mirroring the community sidebar.
 */
export function messagePreview(
  last: DmPreviewMessage | null,
  viewerId: string,
): MessagePreview {
  if (!last) return { prefix: null, text: "", media: null, deleted: false };
  const isOwn = last.user_id === viewerId;
  if (last.deleted_at) {
    return { prefix: isOwn ? "You" : null, text: "This message was deleted", media: null, deleted: true };
  }
  if (last.image_url && !last.content) {
    return { prefix: isOwn ? "You" : null, text: "Photo", media: "image", deleted: false };
  }
  return { prefix: isOwn ? "You" : null, text: last.content ?? "", media: null, deleted: false };
}
