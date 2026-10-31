import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimit } from "@/lib/auth/rate-limit";
import { canReportTarget } from "@/lib/moderation/target-visibility";
import type { Json } from "@/lib/supabase/database.types";
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
  is_public: boolean | null;
  snapshot: Record<string, unknown>;
}

const CONTENT_SELECTIONS: Record<ReportableContentType, string> = {
  thread: "id, user_id, community_id, title, created_at, attachments, poll, links, tags, category, is_public",
  showcase: "id, user_id, community_id, title, created_at, image_url, attachments, category, is_public",
  resource: "id, user_id, community_id, title, created_at, description, url, resource_type, is_public",
  event: "id, user_id, community_id, title, created_at, description, cover_image_url, event_date, end_date, location, is_online",
};

function contentSnapshot(
  contentType: ReportableContentType,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const base = {
    kind: contentType,
    title: row.title ?? null,
    community_id: row.community_id ?? null,
    author_id: row.user_id ?? null,
    created_at: row.created_at ?? null,
    is_public: row.is_public ?? null,
  };
  switch (contentType) {
    case "thread":
      return {
        ...base,
        attachments: row.attachments ?? [],
        poll: row.poll ?? null,
        links: row.links ?? [],
        tags: row.tags ?? [],
        category: row.category ?? null,
      };
    case "showcase":
      return {
        ...base,
        image_url: row.image_url ?? null,
        attachments: row.attachments ?? [],
        category: row.category ?? null,
      };
    case "resource":
      return {
        ...base,
        description: row.description ?? null,
        url: row.url ?? null,
        resource_type: row.resource_type ?? null,
      };
    case "event":
      return {
        ...base,
        description: row.description ?? null,
        cover_image_url: row.cover_image_url ?? null,
        event_date: row.event_date ?? null,
        end_date: row.end_date ?? null,
        location: row.location ?? null,
        is_online: row.is_online ?? null,
      };
  }
}

/** The content row a report points at, or null when it no longer exists. */
async function loadTarget(
  db: ReturnType<typeof createServiceClient>,
  contentType: ReportableContentType,
  contentId: string,
): Promise<{ data: ReportTarget | null; error: unknown }> {
  const table = contentType === "thread"
    ? "community_threads"
    : contentType === "showcase"
      ? "community_showcase_posts"
      : contentType === "resource"
        ? "community_resources"
        : "community_events";
  const result = await db.from(table).select(CONTENT_SELECTIONS[contentType]).eq("id", contentId).maybeSingle();
  if (result.error || !result.data) return { data: null, error: result.error };
  const row = result.data as unknown as Record<string, unknown>;
  return {
    data: {
      id: String(row.id),
      user_id: String(row.user_id),
      community_id: (row.community_id as string | null) ?? null,
      title: (row.title as string | null) ?? null,
      is_public: typeof row.is_public === "boolean" ? row.is_public : null,
      snapshot: contentSnapshot(contentType, row),
    },
    error: null,
  };
}

/**
 * File a content report. Snapshots the post's author and title onto the report
 * so the admin dashboard can still render it after the post is gone, and lets
 * the database's partial unique index reject a duplicate open report.
 */
export async function POST(request: NextRequest) {
  let session;
  try {
    session = await requireSession("user", { allowUnverified: true });
  } catch (error) {
    return error as Response;
  }

  const reportLimit = await rateLimit(`content-report:${session.userId}`, 30, 3600);
  if (!reportLimit.success) {
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
  if (!(await canReportTarget(db, userId, target.community_id, target.is_public !== true))) {
    return NextResponse.json({ error: "That content no longer exists." }, { status: 404 });
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: targetReports } = await db
    .from("content_reports")
    .select("id", { count: "exact", head: true })
    .eq("content_type", contentType)
    .eq("content_id", contentId)
    .gte("created_at", since);
  if ((targetReports ?? 0) >= 25) {
    return NextResponse.json(
      { error: "This content has already been reported by many members. Our team is reviewing it." },
      { status: 429 },
    );
  }

  const { error: insertError } = await db.from("content_reports").insert({
    reporter_id: userId,
    content_type: contentType,
    content_id: contentId,
    community_id: target.community_id,
    content_author_id: target.user_id,
    content_title: target.title,
    target_snapshot: target.snapshot as Json,
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
