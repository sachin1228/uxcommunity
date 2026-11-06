/** Compound cursor for the home feed's `(created_at desc, id desc)` order. */
export interface HomeFeedCursor {
  before: string;
  beforeId: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse the cursor query parameters. `before_id` is optional so a pre-upgrade
 * link still loads, but when it is present it must be a UUID and is only used
 * together with a valid timestamp.
 */
export function parseHomeFeedCursor(
  before: string | null,
  beforeId: string | null,
): { ok: true; before: string | null; beforeId: string | null } | { ok: false } {
  if (!before) return { ok: true, before: null, beforeId: null };
  if (Number.isNaN(Date.parse(before))) return { ok: false };
  if (beforeId !== null && !UUID_PATTERN.test(beforeId)) return { ok: false };
  return { ok: true, before, beforeId };
}

/** The two query parameters that continue after the given card. */
export function homeFeedCursorQuery(item: { created_at: string; id: string }): string {
  return `before=${encodeURIComponent(item.created_at)}&before_id=${encodeURIComponent(item.id)}`;
}
