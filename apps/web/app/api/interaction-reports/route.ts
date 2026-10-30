import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimit } from "@/lib/auth/rate-limit";
import {
  INTERACTION_REPORT_TYPE_VALUES,
  REPORT_DETAILS_MAX_LENGTH,
  type InteractionReportType,
  isReportReasonValidFor,
} from "@/lib/communities/report-reasons";
import { loadInteractionTarget } from "@/lib/moderation/interaction-reports";
import { canReportTarget } from "@/lib/moderation/target-visibility";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Report a comment, a community chat message, a profile, a whole community or
 * a job listing.
 *
 * The target is loaded and snapshotted at report time, so the admin queue
 * still reads after the target is edited or deleted. Posts keep using
 * /api/content-reports; the two queues are separate on purpose (see the
 * interaction_reports migration).
 *
 * Every field the report needs is derived from the target row loaded here —
 * the client only names the target and the reason, so it cannot forge the
 * owner, excerpt or context of an arbitrary id.
 */
export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireSession("user", { allowUnverified: true });
  } catch (error) {
    return error as Response;
  }
  const userId = session.userId!;

  const limit = await rateLimit(`interaction-report:${userId}`, 30, 3600, { failClosed: true });
  if (!limit.success) {
    return NextResponse.json(
      { error: "Too many reports. Please try again later." },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const contentType = typeof body.content_type === "string" ? body.content_type : "";
  const contentId = typeof body.content_id === "string" ? body.content_id : "";
  const reason = typeof body.reason === "string" ? body.reason : "";
  const details = typeof body.details === "string" ? body.details.trim() : "";

  if (!INTERACTION_REPORT_TYPE_VALUES.has(contentType)) {
    return NextResponse.json({ error: "Unknown content type." }, { status: 422 });
  }
  if (!UUID_PATTERN.test(contentId)) {
    return NextResponse.json({ error: "Unknown content." }, { status: 422 });
  }
  // The reason list belongs to the target: a job listing only accepts the
  // recruitment reasons it offered, and so on.
  if (!isReportReasonValidFor(contentType as InteractionReportType, reason)) {
    return NextResponse.json({ error: "Choose a reason." }, { status: 422 });
  }
  if (details.length > REPORT_DETAILS_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Details must be under ${REPORT_DETAILS_MAX_LENGTH} characters.` },
      { status: 422 },
    );
  }

  const targetType = contentType as InteractionReportType;

  // Communities and job listings are higher-impact than a single comment, so
  // they get a tighter per-target limit on top of the shared hourly one. This
  // stops a member mass-reporting every community or posting on the board.
  if (targetType === "community" || targetType === "job") {
    const targetLimit = await rateLimit(
      `interaction-report:${targetType}:${userId}`,
      10,
      3600,
      { failClosed: true },
    );
    if (!targetLimit.success) {
      return NextResponse.json(
        { error: "Too many reports. Please try again later." },
        { status: 429 },
      );
    }
  }

  const db = createServiceClient();
  const target = await loadInteractionTarget(db, targetType, contentId);
  if (!target) {
    return NextResponse.json({ error: "This content is no longer available." }, { status: 404 });
  }
  if (target.authorId === userId) {
    return NextResponse.json({ error: "You cannot report your own content." }, { status: 422 });
  }
  if (!(await canReportTarget(db, userId, target.communityId))) {
    return NextResponse.json({ error: "This content is no longer available." }, { status: 404 });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: targetReports } = await (db as unknown as SupabaseClient)
    .from("interaction_reports")
    .select("id", { count: "exact", head: true })
    .eq("target_type", targetType)
    .eq("target_id", contentId)
    .gte("created_at", since);
  if ((targetReports ?? 0) >= 25) {
    return NextResponse.json(
      { error: "This content has already been reported by many members. Our team is reviewing it." },
      { status: 429 },
    );
  }

  const { error } = await (db as unknown as SupabaseClient)
    .from("interaction_reports")
    .insert({
      reporter_id: userId,
      target_type: targetType,
      target_id: contentId,
      context_id: target.contextId,
      community_id: target.communityId,
      target_author_id: target.authorId,
      target_author_name: target.authorName,
      target_excerpt: target.excerpt,
      context_title: target.contextTitle,
      target_snapshot: target.snapshot,
      reason,
      details: details || null,
    });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "You have already reported this. Our team is reviewing it." },
        { status: 409 },
      );
    }
    console.error("[interaction-reports] insert error:", error);
    return NextResponse.json({ error: "Failed to submit your report." }, { status: 500 });
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
