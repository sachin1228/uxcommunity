import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import {
  ALL_REPORT_REASON_VALUES,
  INTERACTION_REPORT_TYPE_VALUES,
  type InteractionReportType,
} from "@/lib/communities/report-reasons";

const PAGE_SIZE = 25;
const STATUS_VALUES = new Set(["pending", "removed", "actioned", "dismissed", "all"]);

function isoDate(value: string | null, endOfDay = false): string | null {
  if (!value) return null;
  const parsed = Date.parse(endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

/**
 * The unified moderation queue — comments, community chat messages, profiles,
 * communities and job listings. Post-level reports stay on
 * /api/admin/reports.
 *
 * Filters: status, target type, reason, and a submitted-date range. Every
 * filter is validated here, so an arbitrary query string can never widen the
 * read beyond the values the queue supports.
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

  const requestedType = searchParams.get("target_type") ?? "";
  const targetType = INTERACTION_REPORT_TYPE_VALUES.has(requestedType)
    ? (requestedType as InteractionReportType)
    : "";

  const requestedReason = searchParams.get("reason") ?? "";
  const reason = ALL_REPORT_REASON_VALUES.has(requestedReason) ? requestedReason : "";

  const from = isoDate(searchParams.get("from"));
  const to = isoDate(searchParams.get("to"), true);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const db = createServiceClient();
  const view = (db as unknown as SupabaseClient).from("interaction_report_queue");

  function filtered(head = false) {
    let query = head
      ? (view as unknown as {
          select: (cols: string, opts: { count: "exact"; head: true }) => any;
        }).select("id", { count: "exact", head: true })
      : view.select("*", { count: "exact" });
    if (targetType) query = query.eq("target_type", targetType);
    if (reason) query = query.eq("reason", reason);
    if (from) query = query.gte("created_at", from);
    if (to) query = query.lte("created_at", to);
    return query;
  }

  const listQuery = filtered()
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const [
    { data, error, count },
    pendingCount,
    removedCount,
    actionedCount,
    dismissedCount,
  ] = await Promise.all([
    status === "all" ? listQuery : listQuery.eq("status", status),
    filtered(true).eq("status", "pending"),
    filtered(true).eq("status", "removed"),
    filtered(true).eq("status", "actioned"),
    filtered(true).eq("status", "dismissed"),
  ]);

  if (error) {
    console.error("[admin/interaction-reports] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch reports." }, { status: 500 });
  }

  return NextResponse.json({
    reports: data ?? [],
    total: count ?? 0,
    page,
    pageSize: PAGE_SIZE,
    counts: {
      pending: pendingCount.count ?? 0,
      removed: removedCount.count ?? 0,
      actioned: actionedCount.count ?? 0,
      dismissed: dismissedCount.count ?? 0,
    },
  });
}
