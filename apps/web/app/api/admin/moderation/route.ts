import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { requireSession } from "@/lib/auth/session";

const PAGE_SIZE = 50;
const STATUSES = new Set(["approved", "review", "rejected"]);

export async function GET(request: NextRequest) {
  try {
    await requireSession("admin");
  } catch (e) {
    return e as Response;
  }

  const status = request.nextUrl.searchParams.get("status") ?? "review";
  const page = Math.max(1, Number.parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10));
  const safeStatus = STATUSES.has(status) ? status : "review";
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const db = createServiceClient();
  const [eventsResult, countsResult] = await Promise.all([
    db
      .from("moderation_events")
      .select("id, user_id, content_type, content_ref_id, status, reason, provider, confidence, triggered_rules, scores, duration_ms, moderator_notes, created_at, users(name, email)", { count: "exact" })
      .eq("status", safeStatus)
      .order("created_at", { ascending: false })
      .range(from, to),
    db.from("moderation_events").select("status"),
  ]);

  if (eventsResult.error) {
    console.error("[admin/moderation] GET error:", eventsResult.error);
    return NextResponse.json({ error: "Failed to fetch moderation events." }, { status: 500 });
  }

  const counts = { approved: 0, review: 0, rejected: 0 };
  for (const row of countsResult.data ?? []) {
    if (row.status in counts) counts[row.status as keyof typeof counts] += 1;
  }

  return NextResponse.json({
    events: eventsResult.data ?? [],
    total: eventsResult.count ?? 0,
    counts,
    page,
    pageSize: PAGE_SIZE,
  });
}
