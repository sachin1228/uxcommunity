/**
 * Community message cursors — the query string half of the compound
 * `(created_at, id)` cursor.
 *
 * WHY THIS EXISTS
 *   One timestamp can hold several messages, so a cursor made of the timestamp
 *   alone cannot name a position: paging from it either re-reads the whole
 *   burst or skips the rows on the far side of a boundary. Both halves
 *   therefore travel together, exactly as they do for direct messages
 *   (lib/direct-messages/cursor.ts) and as the RPC's row-value comparison
 *   expects (20261013100000_community_message_compound_cursor.sql):
 *
 *     before=<ts>&before_id=<id>   — walk up into history
 *     after=<ts>&after_id=<id>     — drain forward from the newest row a client
 *                                    already holds
 *
 * ORDERING IS PART OF THE CONTRACT
 *   The cursor must be the newest/oldest row under the SAME total order the
 *   server pages on: `(created_at, id)`. Use compareCommunityMessages
 *   (./messages.ts) to pick it — never `Array#at(-1)` on a differently ordered
 *   array.
 *
 * The normalization helpers duplicate read-models.ts's on purpose: that module
 * is `server-only` (it drags the service-role client in), so client code cannot
 * import them. Same contract, same "Z" form — see the DM module for the
 * precedent and the reason (Cloudflare's pipeline decodes a literal `+` in a
 * query value as a space).
 */

export interface MessageCursor {
  /** UTC timestamp, in the "…Z" form the API expects. */
  ts: string;
  /** The message id that disambiguates equal timestamps. */
  id: string;
}

/** Serialize a PostgREST timestamptz ("…+00:00") as the "…Z" form used in cursors. */
export function toUtcCursor(value: string): string {
  return value.endsWith("+00:00") ? `${value.slice(0, -6)}Z` : value;
}

/** Parse an incoming cursor into the canonical "…Z" form; null = malformed. */
export function normalizeUtcCursor(value: string | null | undefined): string | null {
  if (value == null) return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?:\+00:00| 00:00|Z)$/.exec(
    value.trim(),
  );
  return match ? `${match[1]}Z` : null;
}

/**
 * Query string for one message page.
 *
 * At most one side is ever non-null: `before` pages up into history, `after`
 * drains forward, and the RPC's two branches are mutually exclusive. The
 * content-reaction groups (the chat timeline's "created a …" card pills) ride
 * on the same response and are opt-in there, so the chat's own reads request
 * them explicitly.
 */
export function communityMessagePageSearch(
  cursors: { before?: MessageCursor | null; after?: MessageCursor | null } = {},
  options: { contentReactions?: boolean } = {},
): string {
  const params: string[] = [];
  if (cursors.before) {
    params.push(`before=${encodeURIComponent(toUtcCursor(cursors.before.ts))}`);
    params.push(`before_id=${encodeURIComponent(cursors.before.id)}`);
  }
  if (cursors.after) {
    params.push(`after=${encodeURIComponent(toUtcCursor(cursors.after.ts))}`);
    params.push(`after_id=${encodeURIComponent(cursors.after.id)}`);
  }
  if (options.contentReactions) params.push("withContentReactions=1");
  return params.length > 0 ? `?${params.join("&")}` : "";
}
