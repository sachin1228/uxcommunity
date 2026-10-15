/**
 * The chat message page's author map, as the RPC ships it.
 *
 * WHY THIS EXISTS
 *   The page used to carry `users` — name, avatar and designation — on every
 *   row, rebuilt from three joins per message: 26% of the page measured, and a
 *   cost that grew with the number of MESSAGES rather than the number of PEOPLE
 *   in the room (docs/supabase-egress-audit.md §4 #4). It now rides once per
 *   page, keyed by the id a message row already carries
 *   (20261015170000_message_page_author_map), and the loader fills each
 *   message's own `users` from it before anything reads the page.
 *
 *   Nothing may trust that jsonb: it is built by SQL this app does not type, and
 *   a malformed entry must degrade to "no author known" — which every chat
 *   surface already renders — rather than reach a component as a name that is
 *   not a string.
 */

/** One author, in the shape `CachedMessage.users` has always had. */
export interface MessageAuthor {
  name: string;
  avatar_url: string | null;
  designation: string | null;
}

/** The page's authors, keyed by user id. */
export type MessageAuthorMap = Record<string, MessageAuthor>;

function asNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Read the RPC's `authors` column.
 *
 * A missing or non-object value is an empty map — that is also what an
 * un-migrated database looks like, where the per-row `users` blob is still
 * present and this map is simply not there. An entry without a usable name is
 * dropped: a key with no name could only render as an empty label, and the
 * "Member" placeholder is the honest answer for it.
 */
export function parseMessageAuthorMap(value: unknown): MessageAuthorMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};

  const authors: MessageAuthorMap = {};
  for (const [userId, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.name !== "string" || !row.name) continue;
    authors[userId] = {
      name: row.name,
      avatar_url: asNullableString(row.avatar_url),
      designation: asNullableString(row.designation),
    };
  }
  return authors;
}
