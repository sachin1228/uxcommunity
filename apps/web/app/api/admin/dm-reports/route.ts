import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { REPORT_REASON_VALUES } from "@/lib/communities/report-reasons";

const PAGE_SIZE = 25;

const STATUS_VALUES = new Set(["pending", "reviewed", "dismissed", "all"]);

/**
 * The DM report queue reads the `dm_report_queue` view — one row per report
 * with both names resolved, the stored message snapshot and the review
 * state. Same shape as the content-reports queue route: filters ride the
 * query string and every column name here is a hardcoded literal.
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

  const requestedReason = searchParams.get("reason") ?? "";
  const reason = REPORT_REASON_VALUES.has(requestedReason) ? requestedReason : "";

  // Commas/parens would break the PostgREST or() expression; strip them rather
  // than 500 on a pasted name.
  const search = (searchParams.get("search") ?? "").trim().slice(0, 80).replace(/[,()]/g, " ");

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const db = createServiceClient();
  const view = (db as unknown as SupabaseClient).from("dm_report_queue");

  /** Every active filter except status — reused for the tab counts. */
  function applyFilters(query: any): any {
    let next = query;
    if (reason) next = next.eq("reason", reason);
    if (search) {
      next = next.or(
        `reporter_name.ilike.%${search}%,reported_user_name.ilike.%${search}%`,
      );
    }
    return next;
  }

  const listQuery = applyFilters(view.select("*", { count: "exact" }))
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const [{ data, error, count }, pendingCount, reviewedCount, dismissedCount] = await Promise.all([
    status === "all" ? listQuery : listQuery.eq("status", status),
    applyFilters(view.select("id", { count: "exact", head: true })).eq("status", "pending"),
    applyFilters(view.select("id", { count: "exact", head: true })).eq("status", "reviewed"),
    applyFilters(view.select("id", { count: "exact", head: true })).eq("status", "dismissed"),
  ]);

  if (error) {
    console.error("[admin/dm-reports] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch reports." }, { status: 500 });
  }

  return NextResponse.json({
    reports: data ?? [],
    total: count ?? 0,
    counts: {
      pending: pendingCount.count ?? 0,
      reviewed: reviewedCount.count ?? 0,
      dismissed: dismissedCount.count ?? 0,
    },
  });
}
