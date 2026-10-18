/**
 * Reply-preview author ids.
 *
 * A reply quote wears the quoted author's chat colour, which is derived from
 * their user id (see lib/communities/user-color). The message-page RPC only
 * started returning that id with migration 20261019100000; a database still on
 * the older function returns the preview with a name but no id, and every
 * client then renders the neutral grey fallback.
 *
 * These helpers let the page loader recover the id from the page itself, or
 * from one batched lookup when the quoted message falls outside it, so the
 * colour does not depend on which deployment answered the request.
 */

/** A message row carrying an optional quoted-message preview. */
export interface ReplyPreviewCarrier {
  reply_to?: { id?: string | null; user_id?: string | null } | null;
}

/**
 * Ids of quoted messages whose preview lacks an author id, first-seen order,
 * each listed once. Previews of "created a …" cards carry no id at all and are
 * left alone — those quotes are grey by design.
 */
export function missingReplyAuthorIds(
  messages: readonly ReplyPreviewCarrier[],
): string[] {
  const missing = new Set<string>();
  for (const message of messages) {
    const reply = message.reply_to;
    if (reply?.id && !reply.user_id) missing.add(reply.id);
  }
  return [...missing];
}

/**
 * Fill `reply_to.user_id` from a lookup of quoted message id → author id.
 * Previews that already know their author are never overwritten, and unknown
 * ids stay neutral. Returns how many previews changed.
 */
export function applyReplyAuthorIds(
  messages: readonly ReplyPreviewCarrier[],
  authors: ReadonlyMap<string, string>,
): number {
  let changed = 0;
  for (const message of messages) {
    const reply = message.reply_to;
    if (!reply?.id || reply.user_id) continue;
    const authorId = authors.get(reply.id);
    if (!authorId) continue;
    reply.user_id = authorId;
    changed += 1;
  }
  return changed;
}
