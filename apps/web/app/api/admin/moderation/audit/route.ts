import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { loadAuditFeed, MODERATION_AUDIT_ACTIONS } from "@/lib/moderation/audit";

const TARGET_TYPES = new Set([
  "thread_comment",
  "showcase_comment",
  "resource_comment",
  "event_comment",
  "community_message",
  "profile",
  "community",
  "job",
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isoDate(value: string | null, endOfDay = false): string | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(endOfDay ? `${value}T23:59:59.999Z` : `${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined;
}

/**
 * Read-only view of the moderation audit trail for administrators.
 * There is deliberately no mutation route: the table itself rejects
 * UPDATE/DELETE.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const { searchParams } = request.nextUrl;
  const requestedType = searchParams.get("target_type") ?? "";
  const targetType = TARGET_TYPES.has(requestedType) ? requestedType : undefined;

  const requestedTargetId = searchParams.get("target_id") ?? "";
  const targetId = UUID_PATTERN.test(requestedTargetId) ? requestedTargetId : undefined;

  const requestedReportId = searchParams.get("report_id") ?? "";
  const reportId = UUID_PATTERN.test(requestedReportId) ? requestedReportId : undefined;

  const requestedAction = searchParams.get("action") ?? "";
  const action = (MODERATION_AUDIT_ACTIONS as readonly string[]).includes(requestedAction)
    ? requestedAction
    : undefined;

  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);

  const db = createServiceClient();
  const { rows, total } = await loadAuditFeed(db, {
    targetType,
    targetId,
    reportId,
    action,
    from: isoDate(searchParams.get("from")),
    to: isoDate(searchParams.get("to"), true),
    page,
    pageSize: 25,
  });

  return NextResponse.json({ entries: rows, total, page, pageSize: 25 });
}
