/**
 * UTC cursor normalization for DM pagination.
 *
 * PostgREST serializes UTC timestamptz values with a "+00:00" offset, but the
 * Cloudflare runtime decodes a '+' inside a query value as a space — mangling
 * the cursor ("…+00:00" → "… 00:00") before the API can read it. Cursors
 * travel in the "…Z" form so pagination survives the trip unchanged.
 *
 * Same contract as lib/communities/read-models's normalizeUtcCursor; this
 * module is importable from client code (the community one drags the server
 * client in).
 */

/** Parse an incoming cursor into the canonical "…Z" form; null = malformed. */
export function normalizeUtcCursor(value: string | null | undefined): string | null {
  if (value == null) return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?)(?:\+00:00| 00:00|Z)$/.exec(value.trim());
  return match ? `${match[1]}Z` : null;
}

/** Serialize a PostgREST timestamptz ("…+00:00") as the "…Z" form. */
export function toUtcCursor(value: string): string {
  return value.endsWith("+00:00") ? `${value.slice(0, -6)}Z` : value;
}

/**
 * Query string for a compound (created_at, id) page cursor.
 *
 * Both halves travel together: `before`/`after` alone address a millisecond
 * that can hold several messages, and paging on the timestamp alone is what
 * let a same-millisecond burst straddle a page boundary and lose a row. The
 * id half disambiguates; see 20261012120000_dm_hardening.sql.
 */
export function dmCursorQuery(cursors: {
  before?: { ts: string; id: string } | null;
  after?: { ts: string; id: string } | null;
}): string {
  const parts: string[] = [];
  if (cursors.before) {
    parts.push(`before=${encodeURIComponent(toUtcCursor(cursors.before.ts))}`);
    parts.push(`before_id=${encodeURIComponent(cursors.before.id)}`);
  }
  if (cursors.after) {
    parts.push(`after=${encodeURIComponent(toUtcCursor(cursors.after.ts))}`);
    parts.push(`after_id=${encodeURIComponent(cursors.after.id)}`);
  }
  return parts.length > 0 ? `?${parts.join("&")}` : "";
}
