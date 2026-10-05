import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { REPORT_CONTENT_TYPE_VALUES, REPORT_REASON_VALUES } from "@/lib/communities/report-reasons";

const PAGE_SIZE = 25;

const STATUS_VALUES = new Set(["pending", "removed", "dismissed", "all"]);

/** Sort keys the dashboard offers, mapped to the view's columns. */
const SORT_OPTIONS: Record<string, { column: string; ascending: boolean }> = {
  newest: { column: "last_reported_at", ascending: false },
  oldest: { column: "last_reported_at", ascending: true },
  most_reported: { column: "report_count", ascending: false },
};

/**
 * The report queue reads the `report_groups` view: one row per reported POST
 * (a thread can be reported by many members), with the group's status, report
 * count and restore-ability already computed in SQL. The view is not in the
 * generated types, so the reviewed query uses the untyped hop — every filter,
 * sort and column name here is a hardcoded literal, never request input.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const { searchParams } = request.nextUrl;

  const requestedStatus = searchParams.get("status") ?? "pending";
  const status = STATUS_VALUES.has(requestedStatus) ? requestedStatus : "pending";

  const requestedType = searchParams.get("content_type") ?? "";
  const contentType = REPORT_CONTENT_TYPE_VALUES.has(requestedType) ? requestedType : "";

  const requestedReason = searchParams.get("reason") ?? "";
  const reason = REPORT_REASON_VALUES.has(requestedReason) ? requestedReason : "";

  const requestedSort = searchParams.get("sort") ?? "newest";
  const sort = SORT_OPTIONS[requestedSort] ?? SORT_OPTIONS.newest;

  // Commas/parens would break the PostgREST or() expression; strip them rather
  // than 500 on a pasted title.
  const search = (searchParams.get("search") ?? "").trim().slice(0, 80).replace(/[,()]/g, " ");

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const db = createServiceClient();
  const view = (db as unknown as SupabaseClient).from("report_groups");

  /**
   * Every active filter except status — reused for the tab counts. The builder
   * is untyped (the view is not in the generated types), so it stays `any`
   * inside this one helper rather than leaking casts through the route.
   */
  function applyFilters(query: any): any {
    let next = query;
    if (contentType) next = next.eq("content_type", contentType);
    if (reason) next = next.contains("reasons", [reason]);
    if (search) {
      next = next.or(
        `content_title.ilike.%${search}%,author_name.ilike.%${search}%,community_name.ilike.%${search}%`,
      );
    }
    return next;
  }

  const listQuery = applyFilters(view.select("*", { count: "exact" }))
    .order(sort.column, { ascending: sort.ascending })
    .order("last_reported_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const [{ data, error, count }, pendingCount, removedCount, dismissedCount] = await Promise.all([
    status === "all" ? listQuery : listQuery.eq("status", status),
    applyFilters(view.select("content_id", { count: "exact", head: true })).eq("status", "pending"),
    applyFilters(view.select("content_id", { count: "exact", head: true })).eq("status", "removed"),
    applyFilters(view.select("content_id", { count: "exact", head: true })).eq("status", "dismissed"),
  ]);

  if (error) {
    console.error("[admin/reports] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch reports." }, { status: 500 });
  }

  return NextResponse.json({
    groups: data ?? [],
    total: count ?? 0,
    counts: {
      pending: pendingCount.count ?? 0,
      removed: removedCount.count ?? 0,
      dismissed: dismissedCount.count ?? 0,
    },
  });
}
