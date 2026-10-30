import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimit } from "@/lib/auth/rate-limit";
import {
  APPEAL_DAILY_LIMIT,
  APPEAL_MESSAGE_MAX_LENGTH,
  appealBlockedMessage,
  validateAppeal,
} from "@/lib/moderation/appeals";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ModeratedReportRow {
  id: string;
  target_type: string;
  target_id: string;
  context_id: string | null;
  community_id: string | null;
  context_title: string | null;
  target_excerpt: string | null;
  reason: string;
  status: string;
  resolution_note: string | null;
  resolved_at: string | null;
  created_at: string;
  target_author_id: string | null;
}

interface AppealRow {
  id: string;
  report_id: string;
  message: string;
  status: "pending" | "granted" | "denied";
  resolution_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

/**
 * The member's moderation-appeal surface.
 *
 * GET returns every resolved moderation action against the signed-in member,
 * with the appeal already filed (if any). One appeal per report is allowed, so
 * a report that has one no longer offers the form.
 *
 * POST files the appeal. The account must be the one the action was taken
 * against, the report must have ended in a removal or account action, and the
 * member is limited to APPEAL_DAILY_LIMIT appeals per day on top of the
 * database's one-per-report unique index.
 */
export async function GET() {
  let session;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  const db = createServiceClient();
  const userId = session.userId!;

  const [{ data: reports }, { data: appeals }] = await Promise.all([
    (db as unknown as SupabaseClient)
      .from("interaction_reports")
      .select(
        "id, target_type, target_id, context_id, community_id, context_title, target_excerpt, reason, status, resolution_note, resolved_at, created_at, target_author_id",
      )
      .eq("target_author_id", userId)
      .in("status", ["removed", "actioned"])
      .order("resolved_at", { ascending: false })
      .limit(50),
    (db as unknown as SupabaseClient)
      .from("moderation_appeals")
      .select("id, report_id, message, status, resolution_note, created_at, reviewed_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  const appealByReport = new Map(
    ((appeals ?? []) as unknown as AppealRow[]).map((appeal) => [appeal.report_id, appeal]),
  );

  return NextResponse.json({
    items: ((reports ?? []) as unknown as ModeratedReportRow[]).map((report) => ({
      ...report,
      appeal: appealByReport.get(report.id) ?? null,
    })),
  });
}

export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
  }

  const userId = session.userId!;

  const limit = await rateLimit(`moderation-appeal:${userId}`, APPEAL_DAILY_LIMIT, 86400);
  if (!limit.success) {
    return NextResponse.json(
      { error: "Too many appeals today. Please try again tomorrow." },
      { status: 429 },
    );
  }

  const body = (await request.json().catch(() => null)) as
    | { report_id?: string; message?: string }
    | null;
  const reportId = typeof body?.report_id === "string" ? body.report_id : "";
  const message = typeof body?.message === "string" ? body.message : "";

  if (!UUID_PATTERN.test(reportId)) {
    return NextResponse.json({ error: "Unknown report." }, { status: 422 });
  }
  if (message.length > APPEAL_MESSAGE_MAX_LENGTH) {
    return NextResponse.json(
      { error: appealBlockedMessage("message_too_long") },
      { status: 422 },
    );
  }

  const db = createServiceClient();
  const { data: report } = (await (db as unknown as SupabaseClient)
    .from("interaction_reports")
    .select("id, target_type, target_id, target_author_id, status")
    .eq("id", reportId)
    .maybeSingle()) as {
    data: {
      id: string;
      target_type: string;
      target_id: string;
      target_author_id: string | null;
      status: string;
    } | null;
  };

  if (!report) {
    return NextResponse.json({ error: "Unknown report." }, { status: 404 });
  }

  const eligibility = validateAppeal(
    { status: report.status, targetAuthorId: report.target_author_id },
    userId,
    message,
  );
  if (!eligibility.allowed) {
    // Non-owners get the same 404 as a missing report so another member's
    // moderation history is never confirmed by this endpoint.
    if (eligibility.reason === "not_affected_user") {
      return NextResponse.json({ error: "Unknown report." }, { status: 404 });
    }
    return NextResponse.json(
      { error: appealBlockedMessage(eligibility.reason) },
      { status: 422 },
    );
  }

  const { error } = await (db as unknown as SupabaseClient)
    .from("moderation_appeals")
    .insert({
      report_id: report.id,
      user_id: userId,
      target_type: report.target_type,
      target_id: report.target_id,
      message: message.trim(),
    });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "You have already appealed this decision." },
        { status: 409 },
      );
    }
    console.error("[moderation/appeals] insert failed:", error);
    return NextResponse.json({ error: "Failed to submit your appeal." }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
