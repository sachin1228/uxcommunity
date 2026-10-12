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
