import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { callPerformanceRpc } from "@/lib/supabase/performance-rpcs";

const PAGE_SIZE = 25;

const KIND_VALUES = new Set(["thread", "showcase", "resource"]);
const SORT_VALUES = new Set(["engagement", "newest"]);

/**
 * The library pick queue: every post of one kind with its engagement counts
 * and whether it is already on the shelf, ordered by engagement (likes +
 * comments; resources: saves + comments) or recency. The ranking lives in
 * `admin_library_candidates` (20261015180000_library_curation.sql) so paging
 * sorts the whole kind, not just the page.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const { searchParams } = request.nextUrl;

  const requestedKind = searchParams.get("kind") ?? "thread";
  const kind = KIND_VALUES.has(requestedKind) ? requestedKind : "thread";

  const requestedSort = searchParams.get("sort") ?? "engagement";
  const sort = SORT_VALUES.has(requestedSort) ? requestedSort : "engagement";

  // The search rides a bound RPC parameter, so no PostgREST or() escaping is
  // needed — only length and a trim.
  const search = (searchParams.get("search") ?? "").trim().slice(0, 80);

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const db = createServiceClient();
  const { data, error } = await callPerformanceRpc(db, "admin_library_candidates", {
    p_kind: kind,
    p_search: search,
    p_sort: sort,
    p_offset: (page - 1) * PAGE_SIZE,
    p_limit: PAGE_SIZE,
  });

  if (error) {
    console.error("[admin/library] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch posts." }, { status: 500 });
  }

  const items = data ?? [];
  return NextResponse.json({ items, total: items[0]?.total_count ?? 0 });
}
