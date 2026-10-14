import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { rateLimit } from "@/lib/auth/rate-limit";
import { createServiceClient } from "@/lib/supabase/service";
import {
  dmPeerId,
  loadDmConversationForUser,
  loadDmReportSnapshot,
} from "@/lib/direct-messages/server";
import {
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_REASON_VALUES,
} from "@/lib/communities/report-reasons";
import type { Json } from "@/lib/supabase/database.types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/dm/reports  { conversation_id, reason, details? }
 *
 * Report the member on the other side of a DM. The reported member and a
 * snapshot of the conversation's recent messages are stored on the row, so
 * the admin queue (DM Reports) stays readable even after the chat is gone.
 * One open report per member per reported user.
 */
export async function POST(req: NextRequest) {
  let session;
  try {
    session = await requireSession("user");
  } catch (e) {
    return e as Response;
  }
  const userId = session.userId!;

  const body = (await req.json().catch(() => null)) as {
    conversation_id?: unknown;
    reason?: unknown;
    details?: unknown;
  } | null;
  const conversationId =
    typeof body?.conversation_id === "string" && UUID_RE.test(body.conversation_id)
      ? body.conversation_id
      : null;
  const reason = typeof body?.reason === "string" && REPORT_REASON_VALUES.has(body.reason)
    ? body.reason
    : null;
  if (!conversationId || !reason) {
    return NextResponse.json({ error: "Invalid report." }, { status: 422 });
  }
  const details =
    typeof body?.details === "string"
      ? body.details.trim().slice(0, REPORT_DETAILS_MAX_LENGTH)
      : "";

  const db = createServiceClient();
  const [limitResult, access] = await Promise.all([
    rateLimit(`dm:report:${userId}:60s`, 5, 60),
    loadDmConversationForUser(db, conversationId, userId),
  ]);
  if (!limitResult.success) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limitResult.resetAt - Date.now()) / 1000)) } },
    );
  }
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const reportedUserId = dmPeerId(access.conversation, userId);
  const snapshot = await loadDmReportSnapshot(db, conversationId);

  const { error } = (await db.from("dm_reports").insert({
    reporter_id: userId,
    reported_user_id: reportedUserId,
    conversation_id: conversationId,
    reason,
    details: details || null,
    message_snapshot: snapshot as unknown as Json,
  })) as unknown as { error: { code?: string } | null };

  if (error) {
    // 23505 = the pending-report unique index: an earlier report is still open.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "You've already reported this member — our team is on it." },
        { status: 409 },
      );
    }
    console.error("[POST dm report] insert error:", error);
    return NextResponse.json({ error: "Failed to submit your report." }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
