import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { createNotification } from "@/lib/notifications";
import { removeInteractionContent } from "@/lib/moderation/interaction-reports";
import {
  interactionEntityType,
  interactionTargetLabel,
  isRemovableInteraction,
} from "@/lib/moderation/interaction-targets";
import type { InteractionReportType } from "@/lib/communities/report-reasons";

interface ReportRow {
  id: string;
  reporter_id: string;
  target_type: InteractionReportType;
  target_id: string;
  context_id: string | null;
  community_id: string | null;
  target_author_id: string | null;
  target_author_name: string | null;
  target_excerpt: string | null;
  context_title: string | null;
  status: string;
}

const ACTIONS = new Set(["dismiss", "remove"]);

/**
 * Resolve one interaction report.
 *
 *   remove  — deletes the reported comment / chat message, closes the report
 *             and tells the reporter. Profiles are never deleted here: the
 *             reviewer opens the member page and uses block/delete there.
 *   dismiss — closes the report without touching the target.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  const action = typeof body?.action === "string" ? body.action : "";
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: "Unknown action." }, { status: 422 });
  }

  const db = createServiceClient();
  const { data: report, error: loadError } = (await (db as unknown as SupabaseClient)
    .from("interaction_reports")
    .select(
      "id, reporter_id, target_type, target_id, context_id, community_id, target_author_id, target_author_name, target_excerpt, context_title, status",
    )
    .eq("id", id)
    .maybeSingle()) as { data: ReportRow | null; error: unknown };

  if (loadError) {
    console.error("[admin/interaction-reports] load error:", loadError);
    return NextResponse.json({ error: "Failed to load report." }, { status: 500 });
  }
  if (!report) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }
  if (report.status !== "pending") {
    return NextResponse.json({ error: "This report has already been resolved." }, { status: 409 });
  }

  if (action === "remove") {
    if (!isRemovableInteraction(report.target_type)) {
      return NextResponse.json(
        { error: "Profile reports are resolved from the member page." },
        { status: 422 },
      );
    }
    const removal = await removeInteractionContent(db, report.target_type, report.target_id);
    if (!removal.ok) {
      return NextResponse.json({ error: "Failed to remove the content." }, { status: 500 });
    }
  }

  const status = action === "remove" ? "removed" : "dismissed";
  const { error: updateError } = await (db as unknown as SupabaseClient)
    .from("interaction_reports")
    .update({
      status,
      resolved_at: new Date().toISOString(),
      resolved_by: null,
    })
    .eq("id", id);

  if (updateError) {
    console.error("[admin/interaction-reports] update error:", updateError);
    return NextResponse.json({ error: "Failed to resolve the report." }, { status: 500 });
  }

  // Thank the reporter. The row survives if they close their account (FK set
  // null), so a missing reporter is a no-op rather than an error.
  const targetLabel = interactionTargetLabel(report.target_type);
  const href = report.community_id
    ? `/dashboard/communities/${report.community_id}`
    : "/dashboard/notifications";

  await createNotification(db, {
    userId: report.reporter_id,
    actorId: null,
    communityId: report.community_id,
    type: "report_reviewed",
    entityType: interactionEntityType(report.target_type),
    entityId: report.context_id ?? report.target_id,
    title: status === "removed" ? "Thanks for your report" : "Your report was reviewed",
    body:
      status === "removed"
        ? `We reviewed the ${targetLabel} you reported and removed it.`
        : `We reviewed the ${targetLabel} you reported and did not find a violation.`,
    href,
  });

  return NextResponse.json({ success: true, status });
}
