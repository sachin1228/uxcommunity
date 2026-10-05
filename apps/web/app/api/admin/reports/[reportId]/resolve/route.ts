import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { PUBLIC_CONTENT_SCOPE } from "@/lib/content-scope";
import { removeCommunityContent } from "@/lib/communities/content-removal";
import { logCommunityActivity } from "@/lib/communities/manager-role";
import {
  reportReasonLabel,
  type ReportableContentType,
} from "@/lib/communities/report-reasons";
import {
  CONTENT_REMOVAL_TYPES,
  communityHref,
  deferNotification,
  reportReviewedNotice,
  reportedRemovalNotice,
  type NotificationEntityType,
} from "@/lib/notifications";

const ACTIONS = new Set(["remove", "dismiss"]);

interface ReportRecord {
  id: string;
  reporter_id: string;
  content_type: string;
  content_id: string;
  community_id: string | null;
  content_author_id: string | null;
  content_title: string | null;
  reason: string;
  status: string;
}

/**
 * Admin resolution for one report:
 *
 *   - `remove` — takes the post down (through the same removal path the
 *     author/manager delete routes use), then closes EVERY open report on that
 *     post as removed and notifies the author (with the reason) plus each
 *     reporter (thank-you).
 *   - `dismiss` — closes just this report; the post stays up and nobody is
 *     notified.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string }> },
) {
  let session;
  try {
    session = await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const { reportId } = await params;
  const adminId = session.userId!;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: "Unknown action." }, { status: 422 });
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from("content_reports")
    .select(
      "id, reporter_id, content_type, content_id, community_id, content_author_id, content_title, reason, status",
    )
    .eq("id", reportId)
    .maybeSingle();

  if (error) {
    console.error("[admin/reports/resolve] load", error);
    return NextResponse.json({ error: "Failed to load the report." }, { status: 500 });
  }

  const report = (data ?? null) as unknown as ReportRecord | null;
  if (!report) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }
  if (report.status !== "pending") {
    return NextResponse.json({ error: "This report has already been resolved." }, { status: 409 });
  }

  const kind = report.content_type as ReportableContentType;
  const now = new Date().toISOString();

  if (action === "dismiss") {
    const { error: dismissError } = await db
      .from("content_reports")
      .update({ status: "dismissed", resolved_at: now, resolved_by: adminId })
      .eq("id", reportId)
      .eq("status", "pending");

    if (dismissError) {
      console.error("[admin/reports/resolve] dismiss", dismissError);
      return NextResponse.json({ error: "Failed to dismiss the report." }, { status: 500 });
    }

    return NextResponse.json({ ok: true, status: "dismissed", removed: false });
  }

  // ── Remove ──────────────────────────────────────────────────────────────
  const scope = report.community_id ?? PUBLIC_CONTENT_SCOPE;
  const removal = await removeCommunityContent(db, {
    kind,
    id: report.content_id,
    scope,
  });
  if (!removal.ok) {
    console.error("[admin/reports/resolve] removal", removal.error);
    return NextResponse.json({ error: "Failed to remove the content." }, { status: 500 });
  }

  // One takedown answers every open report on the same post.
  const { data: resolvedRows, error: resolveError } = await db
    .from("content_reports")
    .update({ status: "removed", resolved_at: now, resolved_by: adminId })
    .eq("content_type", report.content_type)
    .eq("content_id", report.content_id)
    .eq("status", "pending")
    .select("id, reporter_id");

  if (resolveError) {
    console.error("[admin/reports/resolve] resolve", resolveError);
    return NextResponse.json({ error: "Failed to resolve the report." }, { status: 500 });
  }

  const contentHref = report.community_id
    ? communityHref(report.community_id)
    : "/dashboard/notifications";

  // The author hears why their post came down — the report reason, not just
  // that it was removed.
  if (removal.removed && removal.content) {
    const notice = reportedRemovalNotice(
      kind,
      reportReasonLabel(report.reason),
      report.content_title ?? removal.content.title,
    );
    deferNotification({
      userId: removal.content.userId,
      actorId: adminId,
      communityId: report.community_id,
      type: CONTENT_REMOVAL_TYPES[kind],
      entityType: kind as NotificationEntityType,
      entityId: report.content_id,
      title: () => notice.title,
      body: notice.body,
      href: contentHref,
    });
  }

  // Every reporter who flagged this post gets the thank-you.
  const thanks = reportReviewedNotice(kind, removal.removed);
  const reporterIds = [
    ...new Set((resolvedRows ?? []).map((row: { reporter_id: string }) => row.reporter_id)),
  ];
  for (const reporterId of reporterIds) {
    deferNotification({
      userId: reporterId,
      actorId: adminId,
      communityId: report.community_id,
      type: "report_reviewed",
      entityType: kind as NotificationEntityType,
      entityId: report.content_id,
      title: () => thanks.title,
      body: thanks.body,
      href: contentHref,
    });
  }

  // Best-effort audit trail so the community's managers see the platform
  // action, mirroring the manager delete flow's activity rows.
  if (report.community_id && removal.removed) {
    await logCommunityActivity(db, {
      communityId: report.community_id,
      actorId: adminId,
      actorRole: "platform",
      action: CONTENT_REMOVAL_TYPES[kind],
      targetUserId: removal.content?.userId ?? report.content_author_id,
      details: {
        content_type: kind,
        content_id: report.content_id,
        report_id: report.id,
        reason: report.reason,
      },
    });
  }

  return NextResponse.json({ ok: true, status: "removed", removed: removal.removed });
}
