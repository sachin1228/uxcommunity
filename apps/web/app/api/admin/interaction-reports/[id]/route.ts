import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import type { InteractionReportType } from "@/lib/communities/report-reasons";
import { INTERACTION_REPORT_TYPE_VALUES } from "@/lib/communities/report-reasons";
import {
  allowedModerationActions,
  type ModerationActionId,
} from "@/lib/moderation/action-catalog";
import {
  resolveModerationReport,
  type ModerationReport,
} from "@/lib/moderation/resolve-report";

const NOTE_MAX_LENGTH = 500;

/**
 * Resolve one interaction report — a comment, chat message, profile,
 * community or job listing.
 *
 * The action engine (`lib/moderation/resolve-report.ts`) owns the semantics:
 * comments/messages are deleted, communities hidden, job listings closed with
 * their applications intact, profiles only warned/suspended/banned. Every
 * action writes one append-only audit row and notifies the reporter and (where
 * appropriate) the affected account without ever revealing who reported it.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session;
  try {
    session = await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as
    | { action?: string; note?: string; suspend_days?: number }
    | null;

  const action = typeof body?.action === "string" ? body.action : "";
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, NOTE_MAX_LENGTH) : null;
  const suspendDays =
    typeof body?.suspend_days === "number" ? Math.trunc(body.suspend_days) : null;

  const db = createServiceClient();
  const { data: report, error: loadError } = (await (db as unknown as SupabaseClient)
    .from("interaction_reports")
    .select(
      "id, reporter_id, target_type, target_id, context_id, community_id, target_author_id, target_author_name, target_excerpt, context_title, reason, details, status, target_snapshot",
    )
    .eq("id", id)
    .maybeSingle()) as { data: ModerationReport | null; error: unknown };

  if (loadError) {
    console.error("[admin/interaction-reports] load error:", loadError);
    return NextResponse.json({ error: "Failed to load report." }, { status: 500 });
  }
  if (!report) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }
  if (!INTERACTION_REPORT_TYPE_VALUES.has(report.target_type)) {
    return NextResponse.json({ error: "Unknown report target." }, { status: 422 });
  }
  if (report.status !== "pending") {
    return NextResponse.json({ error: "This report has already been resolved." }, { status: 409 });
  }

  const allowed = allowedModerationActions(report.target_type as InteractionReportType);
  if (!allowed.includes(action as ModerationActionId)) {
    return NextResponse.json({ error: "Unknown action." }, { status: 422 });
  }

  const result = await resolveModerationReport({
    db,
    report: report as ModerationReport,
    action: action as ModerationActionId,
    note: note || null,
    suspendDays,
    moderatorId: session.userId ?? null,
    moderatorSid: session.sid,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ success: true, status: result.status });
}
