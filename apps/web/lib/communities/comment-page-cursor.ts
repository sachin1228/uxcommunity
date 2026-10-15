/**
 * The cursor the four comment lists page on, and the query string that asks for
 * the next page.
 *
 * WHY A CURSOR AND NOT AN OFFSET
 *   Same reason the chat uses one (`./message-cursor.ts`,
 *   20261013100000_community_message_compound_cursor.sql): a comment list is
 *   append-heavy, so a row inserted between two requests shifts every offset by
 *   one and an offset-paged list shows a comment twice or skips one. The cursor
 *   is the last row of the page it came from and pages on `(created_at, id)`,
 *   which is total — equal timestamps cannot straddle a boundary.
 *
 * BOTH HALVES TRAVEL TOGETHER
 *   A lone timestamp is not a cursor: the SQL degrades a missing id to the
 *   all-ones sentinel, which can only re-include rows (harmless duplicates), but
 *   `parseCommentPageRequest` refuses a half cursor anyway and serves the newest
 *   page — a caller that sends one has lost its place, and starting over is
 *   better than a page drawn from a bound it did not mean.
 *
 * This module is deliberately free of server imports so the four detail clients
 * can build the next request with the same constant the routes parse with.
 */

/** The cursor for the page ABOVE the one it was issued with. */
export interface CommentPageCursor {
  /** `created_at` of the oldest top-level comment on that page. */
  before: string;
  /** That comment's id — the tiebreak that makes the order total. */
  beforeId: string;
}

/**
 * The page-level values of a comment response: what is off-screen, and how to
 * ask for it. A server render hands these to its client so "load more" works
 * before the first fetch, and the client hands them back on every response.
 */
export interface CommentPageMeta {
  /** The item's whole comment count (roots and replies), null when unknown. */
  totalCount: number | null;
  /** Whether comments older than the ones on screen exist. */
  hasMore: boolean;
  /** The cursor for the page above this one; null when there is none. */
  nextCursor: CommentPageCursor | null;
}

/** Top-level comments per page. Reaches the reader as one screenful. */
export const COMMENT_PAGE_SIZE = 20;

/** The SQL clamp (`least(greatest(p_limit, 1), 50)`); mirrored so a caller
 *  cannot ask for a bound the database will silently reduce. */
export const COMMENT_PAGE_MAX = 50;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CommentPageRequest {
  limit: number;
  /** Null means "the newest page" — a first load, or a caller that lost its place. */
  cursor: CommentPageCursor | null;
}

/** Reads `?limit=&before=&beforeId=` off a request, ignoring anything malformed. */
export function parseCommentPageRequest(
  searchParams: URLSearchParams,
  defaultLimit: number = COMMENT_PAGE_SIZE,
): CommentPageRequest {
  const requested = Number.parseInt(searchParams.get("limit") ?? "", 10);
  return {
    limit: Number.isFinite(requested)
      ? Math.min(Math.max(requested, 1), COMMENT_PAGE_MAX)
      : Math.min(Math.max(defaultLimit, 1), COMMENT_PAGE_MAX),
    cursor: parseCommentPageCursor(searchParams),
  };
}

function parseCommentPageCursor(searchParams: URLSearchParams): CommentPageCursor | null {
  const before = searchParams.get("before");
  const beforeId = searchParams.get("beforeId");
  if (!before || !beforeId || !UUID_PATTERN.test(beforeId)) return null;
  const parsed = Date.parse(before);
  if (!Number.isFinite(parsed)) return null;
  return { before: new Date(parsed).toISOString(), beforeId: beforeId.toLowerCase() };
}

/**
 * The query string that asks a comment route for the page above `cursor`.
 * Null asks for the newest page — which is what "load more" sends when the
 * server said there is nothing older.
 */
export function commentPageQuery(cursor: CommentPageCursor | null, limit: number = COMMENT_PAGE_SIZE): string {
  const params = new URLSearchParams();
  if (cursor) {
    params.set("before", cursor.before);
    params.set("beforeId", cursor.beforeId);
  }
  params.set("limit", String(limit));
  return `?${params.toString()}`;
}
