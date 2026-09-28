/**
 * The chat-message request body contract.
 *
 * WHY THIS EXISTS
 *   `POST /api/communities/[id]/messages` mixed three unrelated jobs in one
 *   handler: deciding whether the body is a well-formed message, doing the
 *   authorized write (rate limits, membership, reply-anchor validation, mention
 *   resolution, insert), and publishing the result to realtime + push. Only the
 *   first is a pure contract that can be stated and tested on its own, so it
 *   lives here and the route reads like the sequence it is.
 *
 * WHAT "WELL-FORMED" MEANS HERE
 *   * `content` is trimmed; an empty content with no image is `empty` and with
 *     an image is a valid image-only message;
 *   * `reply_to_id` and the content anchor (`reply_to_content`) are captured as
 *     the client sent them — whether they point at a row in *this* community is
 *     decided by the route against the database, not here. A message anchor wins
 *     over a content anchor, so the content anchor is only read when
 *     `reply_to_id` is absent;
 *   * mentions arrive as opaque member ids picked from the client roster; names
 *     are resolved server-side, and the sender is never their own mention.
 *     Mentions only make sense beside text, so they are dropped when the message
 *     has none.
 *
 * REASONS, NOT STATUS CODES
 *   A body that cannot be read at all (`malformed`) is a different client
 *   mistake from one that is readable but invalid (`empty`, `too_long`), and the
 *   route answers them with different statuses. The mapping is deliberately left
 *   to the route: this module never builds a Response.
 */

import { MENTION_MAX_PER_MESSAGE } from "./mentions";

/** Content-anchored replies may target one of the four content kinds only. */
const CONTENT_ANCHOR_KINDS = ["thread", "showcase", "resource", "event"];

/** Longest message the composer accepts, and the column's practical ceiling. */
const MESSAGE_MAX_CHARS = 2000;

export interface MessageRequestBody {
  content: string;
  replyToId: string | null;
  /** Validated *shape* only — the row is looked up by the route. */
  replyToContent: { id: string; kind: string } | null;
  imageUrl: string | null;
  /** Deduped member ids to resolve names for, capped. */
  mentionUserIds: string[];
}

export type MessageRequestBodyResult =
  | { ok: true; value: MessageRequestBody }
  | { ok: false; reason: "malformed" | "empty" | "too_long" };

/**
 * Read and validate the message body. `userId` is the authenticated sender, used
 * only to drop a self-mention.
 */
export async function readMessageRequestBody(
  req: Request,
  userId: string,
): Promise<MessageRequestBodyResult> {
  let content: string;
  let replyToId: string | null = null;
  let replyToContent: { id: string; kind: string } | null = null;
  let imageUrl: string | null = null;
  let mentionUserIds: string[] = [];

  try {
    const body = (await req.json()) as {
      content?: unknown;
      reply_to_id?: unknown;
      reply_to_content?: { id?: unknown; kind?: unknown };
      image_url?: unknown;
      mentions?: unknown;
    };
    content     = ((body.content as string | undefined) ?? "").trim();
    replyToId   = (body.reply_to_id as string | null | undefined) ?? null;
    // Replies can anchor to a content item (thread/showcase/resource/event —
    // the chat timeline's "created a …" cards) instead of a chat message. A
    // message anchor always wins, so this is only read when reply_to_id is
    // absent; the anchor is validated against the community by the route.
    if (
      !replyToId &&
      typeof body.reply_to_content?.id === "string" &&
      typeof body.reply_to_content?.kind === "string" &&
      CONTENT_ANCHOR_KINDS.includes(body.reply_to_content.kind)
    ) {
      replyToContent = { id: body.reply_to_content.id, kind: body.reply_to_content.kind };
    }
    imageUrl    = (body.image_url as string | null | undefined) ?? null;
    // Mentions are sent as opaque member ids picked from the client roster;
    // names are resolved server-side, so storage never trusts the client.
    if (Array.isArray(body.mentions)) {
      const ids = (body.mentions as Array<{ user_id?: unknown }>)
        .filter((m) => m && typeof m.user_id === "string")
        .map((m) => m.user_id as string)
        .filter((id: string) => id && id !== userId);
      mentionUserIds = [...new Set(ids)].slice(0, MENTION_MAX_PER_MESSAGE);
    }
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (!content && !imageUrl) return { ok: false, reason: "empty" };
  if (content.length > MESSAGE_MAX_CHARS) return { ok: false, reason: "too_long" };

  // Mentions only make sense when there is text to mention someone in.
  if (!content) mentionUserIds = [];

  return {
    ok: true,
    value: { content, replyToId, replyToContent, imageUrl, mentionUserIds },
  };
}
