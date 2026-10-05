import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import {
  REPORT_CONTENT_TYPE_VALUES,
  REPORT_DETAILS_MAX_LENGTH,
  REPORT_REASON_VALUES,
  type ReportableContentType,
} from "@/lib/communities/report-reasons";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ReportTarget {
  id: string;
  user_id: string;
  community_id: string | null;
  title: string | null;
}

/** The content row a report points at, or null when it no longer exists. */
async function loadTarget(
  db: ReturnType<typeof createServiceClient>,
  contentType: ReportableContentType,
  contentId: string,
) {
  const selection = "id, user_id, community_id, title";

  switch (contentType) {
    case "thread":
      return db.from("community_threads").select(selection).eq("id", contentId).maybeSingle();
    case "showcase":
      return db.from("community_showcase_posts").select(selection).eq("id", contentId).maybeSingle();
    case "resource":
      return db.from("community_resources").select(selection).eq("id", contentId).maybeSingle();
    case "event":
      return db.from("community_events").select(selection).eq("id", contentId).maybeSingle();
  }
}

/**
 * File a content report. Snapshots the post's author and title onto the report
 * so the admin dashboard can still render it after the post is gone, and lets
 * the database's partial unique index reject a duplicate open report.
 */
export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireSession("user");
  } catch (error) {
    return error as Response;
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

  if (!REPORT_CONTENT_TYPE_VALUES.has(contentType)) {
    return NextResponse.json({ error: "Unknown content type." }, { status: 422 });
  }
  if (!UUID_PATTERN.test(contentId)) {
    return NextResponse.json({ error: "Unknown content." }, { status: 422 });
  }
  if (!REPORT_REASON_VALUES.has(reason)) {
    return NextResponse.json({ error: "Pick a reason for your report." }, { status: 422 });
  }
  if (details.length > REPORT_DETAILS_MAX_LENGTH) {
    return NextResponse.json(
      { error: `Details must be ${REPORT_DETAILS_MAX_LENGTH} characters or fewer.` },
      { status: 422 },
    );
  }

  const userId = session.userId!;
  const db = createServiceClient();
  const { data, error } = await loadTarget(db, contentType as ReportableContentType, contentId);

  if (error) {
    console.error("[POST content-report] target lookup", error);
    return NextResponse.json({ error: "Failed to submit your report." }, { status: 500 });
  }

  const target = (data ?? null) as unknown as ReportTarget | null;
  if (!target) {
    return NextResponse.json({ error: "That content no longer exists." }, { status: 404 });
  }
  if (target.user_id === userId) {
    return NextResponse.json({ error: "You can't report your own post." }, { status: 403 });
  }

  const { error: insertError } = await db.from("content_reports").insert({
    reporter_id: userId,
    content_type: contentType,
    content_id: contentId,
    community_id: target.community_id,
    content_author_id: target.user_id,
    content_title: target.title,
    reason,
    details: details || null,
  });

  if (insertError) {
    // 23505 = the partial unique index caught an open report from this member
    // for this post.
    if ((insertError as { code?: string }).code === "23505") {
      return NextResponse.json(
        { error: "You've already reported this — our team is on it." },
        { status: 409 },
      );
    }
    console.error("[POST content-report] insert", insertError);
    return NextResponse.json({ error: "Failed to submit your report." }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
