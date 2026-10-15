import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";
import type { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";
import { COMMENT_PAGE_SIZE } from "./comment-page-cursor";
import type { CommentPageCursor, CommentPageMeta } from "./comment-page-cursor";

/**
 * One PAGE of a content item's comments — the read every comment surface shares.
 *
 * WHY THIS EXISTS
 *   The four comment routes and the four detail pages each spelled out their own
 *   `… from <kind>_comments where <fk> = $1 order by created_at`, with no bound,
 *   on every mount and every realtime broadcast. A popular thread therefore
 *   transferred its whole discussion — and the author resolver looked up every
 *   distinct author in it — to draw the twenty comments a reader sees
 *   (docs/supabase-egress-audit.md §6).
 *
 *   `get_<kind>_comment_page` (20261015180000_comment_page_cursor) answers with a
 *   window of top-level comments, the replies under them, the item's total count
 *   and the cursor for the next page. This module is the single caller of those
 *   four functions, so the bound, the cursor and the nesting rule cannot drift
 *   apart across four routes.
 *
 * THE FALLBACK IS DELIBERATE
 *   A missing function means the database has not had the migration applied yet.
 *   Rather than turn every comment section into a 500, the read falls back to
 *   the exact query it replaces — the whole list, `totalCount` and `hasMore`
 *   derived from it, no cursor — which the UI renders as a complete list with no
 *   "load more". The same "not installed" codes as comment-reactions.ts, so an
 *   unrelated schema-cache error is never mistaken for an un-migrated database.
 */

/** The four comment surfaces, keyed exactly like the API route segments. */
export type CommentPageKind = "threads" | "resources" | "showcase" | "events";

/** The minimum every comment row has — the shape the nesting and author
 *  attachment below rely on, whatever else the row carries. */
export type CommentPageRow = Record<string, unknown> & {
  id: string;
  user_id: string;
  parent_id: string | null;
  created_at: string;
};

export interface CommentPage<Row extends CommentPageRow = CommentPageRow> {
  /**
   * The page's rows, OLDEST FIRST and FLAT — roots and replies in one list, the
   * order they were written in. Callers enrich them (authors, reactions) while
   * they are flat, then nest with `nestCommentRows`; that order matters, because
   * the reaction lookup is keyed by comment id over the rows it is handed and
   * would miss a reply that had already been nested away.
   */
  rows: Row[];
  /**
   * The item's whole comment count — roots AND replies — or null when the
   * database did not report one (a cursor page past the end returns no rows,
   * and a caller then keeps the count it already had).
   */
  totalCount: number | null;
  /** Whether a further page exists. False once every comment is on screen. */
  hasMore: boolean;
  /** Pass back to `loadCommentPage` for the page above this one. */
  nextCursor: CommentPageCursor | null;
  /** A genuine read failure — the caller decides between 500 and an empty list. */
  error: PostgrestError | null;
  /** True when this page came from the pre-migration unbounded read. */
  legacy: boolean;
}

type Db = ReturnType<typeof createServiceClient>;

/** Each kind's table, foreign key and full column list — the fallback read and
 *  the reply nesting both need to know them, and they differ per kind. */
const KIND_SOURCES: Record<CommentPageKind, { table: string; fk: string; columns: string }> = {
  threads: {
    table: "thread_comments",
    fk: "thread_id",
    columns: "id, thread_id, user_id, parent_id, body, created_at, updated_at",
  },
  resources: {
    table: "resource_comments",
    fk: "resource_id",
    columns: "id, resource_id, user_id, parent_id, body, created_at, updated_at",
  },
  showcase: {
    table: "showcase_comments",
    fk: "post_id",
    columns: "id, post_id, user_id, parent_id, body, created_at, updated_at",
  },
  events: {
    table: "event_comments",
    fk: "event_id",
    // The one kind whose comments can carry an image.
    columns: "id, event_id, user_id, parent_id, body, image_url, created_at, updated_at",
  },
};

/**
 * Codes that mean the page function is not installed yet: PostgREST's missing
 * function/table answers plus the raw Postgres ones a direct call can produce.
 * Mirror of `SUMMARY_RPC_MISSING_CODES` in ./comment-reactions.ts.
 */
const PAGE_RPC_MISSING_CODES = new Set(["PGRST202", "PGRST205", "42883", "42P01", "42501", "3F000"]);

function isPageRpcMissing(error: unknown): boolean {
  const code = (error as { code?: string | null } | null)?.code;
  return typeof code === "string" && PAGE_RPC_MISSING_CODES.has(code);
}

/** One page of `kind`'s comments for `targetId`, newest first. */
export async function loadCommentPage(
  db: Db,
  kind: CommentPageKind,
  targetId: string,
  options: { limit?: number; cursor?: CommentPageCursor | null } = {},
): Promise<CommentPage> {
  const limit = options.limit ?? COMMENT_PAGE_SIZE;
  const cursor = options.cursor ?? null;
  const args = {
    p_limit: limit,
    p_before: cursor?.before ?? null,
    p_before_id: cursor?.beforeId ?? null,
  };

  const { data, error } = await callCommentPageRpc(db, kind, targetId, args);
  if (error) {
    if (!isPageRpcMissing(error)) {
      return { rows: [], totalCount: null, hasMore: false, nextCursor: null, error, legacy: false };
    }
    return await loadCommentPageWithoutPaging(db, kind, targetId);
  }

  const rows = (data ?? []) as unknown as CommentPageRow[];
  return {
    rows,
    totalCount: readPageTotal(rows),
    hasMore: Boolean(rows[0]?.has_more),
    nextCursor: readPageCursor(rows[0]),
    error: null,
    legacy: false,
  };
}

/** The four functions, called through the typed map so their contracts stay
 *  checked (the migration's signatures are not in the generated DB types). */
function callCommentPageRpc(
  db: Db,
  kind: CommentPageKind,
  targetId: string,
  args: { p_limit: number; p_before: string | null; p_before_id: string | null },
) {
  switch (kind) {
    case "threads":
      return callPerformanceRpc(db, "get_thread_comment_page", { p_thread_id: targetId, ...args });
    case "resources":
      return callPerformanceRpc(db, "get_resource_comment_page", { p_resource_id: targetId, ...args });
    case "showcase":
      return callPerformanceRpc(db, "get_showcase_comment_page", { p_post_id: targetId, ...args });
    case "events":
      return callPerformanceRpc(db, "get_event_comment_page", { p_event_id: targetId, ...args });
  }
}

/**
 * The pre-migration read: the whole list in one query, which is exactly what
 * every surface did before this module existed. `hasMore: false` and a null
 * cursor describe it honestly — everything is on screen, so the UI offers no
 * "load more" and the count is the list's own length.
 */
async function loadCommentPageWithoutPaging(
  db: Db,
  kind: CommentPageKind,
  targetId: string,
): Promise<CommentPage> {
  const source = KIND_SOURCES[kind];
  // Generated Supabase types are refreshed after the repository migration runs,
  // so the table name is resolved at runtime here (as comment-reactions.ts does
  // for its own per-kind tables).
  const legacyDb = db as any;
  const { data, error } = await legacyDb
    .from(source.table)
    .select(source.columns)
    .eq(source.fk, targetId)
    .order("created_at", { ascending: true });

  if (error) {
    return { rows: [], totalCount: null, hasMore: false, nextCursor: null, error, legacy: true };
  }

  const rows = (data ?? []) as unknown as CommentPageRow[];
  return {
    rows,
    totalCount: rows.length,
    hasMore: false,
    nextCursor: null,
    error: null,
    legacy: true,
  };
}

/**
 * The page-level values of a loaded page, as the shape a client takes — so a
 * server render does not have to spell out the three fields at every call site.
 */
export function commentPageMeta(page: CommentPage): CommentPageMeta {
  return { totalCount: page.totalCount, hasMore: page.hasMore, nextCursor: page.nextCursor };
}

/** The page's total, carried on ONE row of the page (see the migration). */
function readPageTotal(rows: CommentPageRow[]): number | null {
  const total = rows[0]?.total_count;
  return typeof total === "number" ? total : null;
}

function readPageCursor(row: CommentPageRow | undefined): CommentPageCursor | null {
  const before = row?.next_before;
  const beforeId = row?.next_before_id;
  if (typeof before !== "string" || typeof beforeId !== "string") return null;
  return { before, beforeId };
}

/**
 * Nests each reply under its parent, the shape every comment UI renders.
 *
 * Replies are one level deep — a reply cannot be replied to — so this is a
 * single pass, and it is also why the page function can ship a root's replies
 * with the root rather than paging them separately.
 */
export function nestCommentRows<Row>(rows: Row[]): Array<Row & { replies: Row[] }> {
  // The rows arrive as untyped records (the repository's Supabase client is
  // untyped until generated types are refreshed), so the two fields this reads
  // are narrowed here rather than constrained at the signature — a constraint
  // would reject every `Record<string, unknown>` row, which is what callers have.
  const key = (row: unknown): { id?: unknown; parent_id?: unknown } =>
    row as { id?: unknown; parent_id?: unknown };

  const roots = rows
    .filter((row) => !key(row).parent_id)
    .map((row) => ({ ...row, replies: [] as Row[] }));
  for (const reply of rows) {
    const parentId = key(reply).parent_id;
    if (!parentId) continue;
    roots.find((root) => key(root).id === parentId)?.replies.push(reply);
  }
  return roots;
}
