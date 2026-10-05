import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { REPORT_CONTENT_TYPE_VALUES } from "@/lib/communities/report-reasons";

const PAGE_SIZE = 25;

const STATUS_VALUES = new Set(["pending", "removed", "dismissed", "all"]);

/** Dashboard path segment per content kind (used for the admin "View" link). */
const CONTENT_HREF_SEGMENTS: Record<string, string> = {
  thread: "threads",
  showcase: "showcase",
  resource: "resources",
  event: "events",
};

interface ReportRow {
  id: string;
  reporter_id: string;
  content_type: string;
  content_id: string;
  community_id: string | null;
  content_author_id: string | null;
  content_title: string | null;
  reason: string;
  details: string | null;
  status: string;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
}

/**
 * Loads the ids of the reported posts that still exist, per content kind, so
 * the admin list can show a live/deleted state and link only to real rows.
 */
async function loadExistingContentIds(
  db: ReturnType<typeof createServiceClient>,
  reports: ReportRow[],
): Promise<Set<string>> {
  const idsByType = new Map<string, string[]>();
  for (const report of reports) {
    if (!REPORT_CONTENT_TYPE_VALUES.has(report.content_type)) continue;
    const ids = idsByType.get(report.content_type) ?? [];
    ids.push(report.content_id);
    idsByType.set(report.content_type, ids);
  }

  const tables = {
    thread: "community_threads",
    showcase: "community_showcase_posts",
    resource: "community_resources",
    event: "community_events",
  } as const;

  const existing = new Set<string>();
  await Promise.all(
    [...idsByType.entries()].map(async ([type, ids]) => {
      const table = tables[type as keyof typeof tables];
      const { data, error } = await db.from(table).select("id").in("id", ids);
      if (error) {
        console.error("[admin/reports] content lookup", { type, error });
        return;
      }
      for (const row of data ?? []) existing.add((row as { id: string }).id);
    }),
  );
  return existing;
}

/** id → name for a batch of user or community ids. */
async function loadNames(
  db: ReturnType<typeof createServiceClient>,
  table: "users" | "communities",
  ids: string[],
): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const { data, error } = await db.from(table).select("id, name").in("id", ids);
  if (error) {
    console.error("[admin/reports] name lookup", { table, error });
    return new Map();
  }
  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

export async function GET(request: NextRequest) {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const { searchParams } = request.nextUrl;
  const requestedStatus = searchParams.get("status") ?? "pending";
  const status = STATUS_VALUES.has(requestedStatus) ? requestedStatus : "pending";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const db = createServiceClient();

  let query = db
    .from("content_reports")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  if (status !== "all") {
    query = query.eq("status", status);
  }

  const [
    { data, error, count },
    pendingCount,
    removedCount,
    dismissedCount,
  ] = await Promise.all([
    query,
    db.from("content_reports").select("id", { count: "exact", head: true }).eq("status", "pending"),
    db.from("content_reports").select("id", { count: "exact", head: true }).eq("status", "removed"),
    db.from("content_reports").select("id", { count: "exact", head: true }).eq("status", "dismissed"),
  ]);

  if (error) {
    console.error("[admin/reports] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch reports." }, { status: 500 });
  }

  const reports = (data ?? []) as unknown as ReportRow[];
  const existingContentIds = await loadExistingContentIds(db, reports);

  // Batch the name lookups instead of one query per row.
  const userIds = [
    ...new Set(
      reports.flatMap((report) =>
        [report.reporter_id, report.content_author_id].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    ),
  ];
  const communityIds = [
    ...new Set(reports.map((report) => report.community_id).filter((value): value is string => Boolean(value))),
  ];

  const [userNames, communityNames] = await Promise.all([
    loadNames(db, "users", userIds),
    loadNames(db, "communities", communityIds),
  ]);

  return NextResponse.json({
    reports: reports.map((report) => ({
      ...report,
      reporter_name: userNames.get(report.reporter_id) ?? "Member",
      author_name: report.content_author_id
        ? userNames.get(report.content_author_id) ?? "Member"
        : "Member",
      community_name: report.community_id ? communityNames.get(report.community_id) ?? null : null,
      content_exists: existingContentIds.has(report.content_id),
      href: report.community_id
        ? `/dashboard/communities/${report.community_id}/${CONTENT_HREF_SEGMENTS[report.content_type] ?? "threads"}/${report.content_id}`
        : null,
    })),
    total: count ?? 0,
    counts: {
      pending: pendingCount.count ?? 0,
      removed: removedCount.count ?? 0,
      dismissed: dismissedCount.count ?? 0,
    },
  });
}
