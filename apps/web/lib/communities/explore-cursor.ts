/**
 * The Explore directory's page size, its keyset cursor, and how a page joins
 * the pages already loaded.
 *
 * WHY THIS EXISTS
 *   Explore used to read every active community on the platform in one call
 *   (`get_all_communities`, no LIMIT — docs/supabase-egress-audit.md §4 #2), so
 *   it was the one surface whose cost per visit grew with the whole platform
 *   rather than with what the member actually looked at. The read is bounded and
 *   paged now (20261015150000_all_communities_cursor), and this module is the
 *   page contract shared by both ends: how big a page is, how "start after this
 *   row" is written into a URL and read back, and what a page does to the list
 *   it lands on.
 *
 *   It is deliberately pure — no fetch, no store, no React — because cursor
 *   parsing is the part that has to be exactly right and the part a test can
 *   pin down without a database or a browser.
 */

import type { CachedExploreCommunity } from "./cache/types";

/**
 * One page of the directory.
 *
 * 60 because the list renders three cards to a row on a wide screen, so a page
 * lands on a whole number of rows, and because it matches the RPC's own default
 * so a caller that forgets the parameter still gets a page rather than a
 * surprise.
 */
export const EXPLORE_PAGE_SIZE = 60;

/** The last row of the previous page — what the next page starts after. */
export interface ExploreCursor {
  name: string;
  id: string;
}

export interface ExploreCursorParse {
  /** Where to page from. `null` means "the first page". */
  cursor: ExploreCursor | null;
  /**
   * False for malformed input, which the route answers with 400 rather than
   * silently serving page one (a client that sent a broken cursor would
   * otherwise loop on the same rows forever).
   */
  valid: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The `after` query value for a page's last row. */
export function formatExploreCursor(row: { name: string; id: string }): string {
  return `${row.name}|${row.id}`;
}

/**
 * Read an `after` query value back.
 *
 * The split is at the LAST separator, not the first: a community name is free
 * text and may contain one, while the id half is a UUID and cannot — so the last
 * separator is the only one that is unambiguous. Both halves are required (the
 * SQL predicate is `(name, id) > (after_name, after_id)`, and a name without its
 * id would degenerate to `name >= after_name` and repeat the boundary row).
 */
export function parseExploreCursor(raw: string | null | undefined): ExploreCursorParse {
  if (!raw) return { cursor: null, valid: true };

  const at = raw.lastIndexOf("|");
  if (at <= 0) return { cursor: null, valid: false };

  const name = raw.slice(0, at);
  const id = raw.slice(at + 1);
  if (!name || !UUID_RE.test(id)) return { cursor: null, valid: false };

  return { cursor: { name, id }, valid: true };
}

/**
 * Append a page to the rows already loaded.
 *
 * Ids already in the list are dropped: a community whose name changed between
 * two page reads can be served on both sides of the seam, and the member would
 * then see the same card twice under a duplicate React key.
 *
 * Order is preserved — existing rows keep their places, the page's rows follow
 * in the order the server sent them (which is the list's own order).
 */
export function mergeExploreRows(
  existing: readonly CachedExploreCommunity[],
  incoming: readonly CachedExploreCommunity[],
): CachedExploreCommunity[] {
  const seen = new Set(existing.map((community) => community.id));
  const appended: CachedExploreCommunity[] = [];

  for (const community of incoming) {
    if (seen.has(community.id)) continue;
    seen.add(community.id);
    appended.push(community);
  }

  return appended.length ? [...existing, ...appended] : [...existing];
}
