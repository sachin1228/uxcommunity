/**
 * The kinds of community content a chat message or a reaction can point at,
 * and the table each kind lives in.
 *
 * Declared `as const` on purpose: the Supabase query builder types a table as
 * a string literal, so `db.from(CONTENT_TABLES[kind])` is only checkable while
 * the map's values stay literal. A plain `Record<string, string>` widens them
 * to `string` and makes every query built from the map untypeable.
 */
export const CONTENT_TABLES = {
  thread: "community_threads",
  showcase: "community_showcase_posts",
  resource: "community_resources",
  event: "community_events",
} as const;

export type ContentKind = keyof typeof CONTENT_TABLES;

/** Union of the tables the kinds map to. */
export type ContentTable = (typeof CONTENT_TABLES)[ContentKind];

/**
 * Narrows an untrusted `kind` (a request body field) to a table name, or null
 * when it is not one of the known kinds.
 */
export function contentTableFor(kind: string): ContentTable | null {
  return (CONTENT_TABLES as Record<string, ContentTable | undefined>)[kind] ?? null;
}
