import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServerTimer, estimateJsonBytes } from "@/lib/server-timing";
import { getExplorePage } from "@/lib/communities/explore-page-server";
import {
  EXPLORE_PAGE_SIZE,
  formatExploreCursor,
  parseExploreCursor,
} from "@/lib/communities/explore-cursor";

/**
 * GET /api/communities/all — one page of the Explore directory.
 *
 * This used to be the whole directory: `get_all_communities` had no bound, so
 * every Explore visit read every active community on the platform (measured at
 * ~372 B raw / 73.8 B on the wire per row — docs/supabase-egress-audit.md §4 #2).
 * It now serves a fixed-size page in `(name, id)` order and continues from
 * `?after=name|id` — the last row of the previous page, exactly as the payload
 * carried it. The page size is the server's (`EXPLORE_PAGE_SIZE`), not a client
 * parameter: an unbounded read must not be reachable by asking for one.
 *
 * The pages are cached per member for a minute (explore-page-server.ts), so the
 * member's own membership flags stay theirs and a join still lands immediately.
 */
export async function GET(req: NextRequest) {
  const timer = createServerTimer("GET /api/communities/all");

  let session;
  try {
    session = await timer.measure("auth", () => requireSession("user", { verifyActive: false }));
  } catch (error) {
    timer.finish({ status: error instanceof Response ? error.status : 500 });
    return error as Response;
  }

  // A cursor that does not parse is refused, not treated as "first page": a
  // client paging with a broken cursor would otherwise loop on the same rows.
  const { cursor, valid } = parseExploreCursor(req.nextUrl.searchParams.get("after"));
  if (!valid) {
    timer.finish({ status: 400 });
    return NextResponse.json({ error: "Invalid cursor." }, { status: 400 });
  }

  try {
    const { rows, hasMore } = await timer.measure("database", () =>
      getExplorePage(session.userId!, EXPLORE_PAGE_SIZE, cursor),
    );

    // Only a page with a continuation carries a cursor — `has_more` alone is the
    // whole answer for the last page, and a cursor for a run-out list would ask
    // the client to fetch an empty page.
    const body = {
      communities: rows,
      has_more: hasMore,
      next_cursor: hasMore ? formatExploreCursor(rows[rows.length - 1]) : null,
    };
    const timing = timer.finish({
      database_queries: 1,
      rows: body.communities.length,
      response_bytes: estimateJsonBytes(body),
      status: 200,
    });

    const response = NextResponse.json(body);
    response.headers.set("Server-Timing", timing);
    return response;
  } catch (error) {
    console.error("[GET /api/communities/all] get_all_communities failed", error);
    timer.finish({ database_queries: 1, status: 500 });
    return NextResponse.json({ error: "Failed to fetch communities." }, { status: 500 });
  }
}
