import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { PUBLIC_CONTENT_SCOPE } from "@/lib/content-scope";
import {
  loadContentRow,
  removeCommunityContent,
  restoreRemovedContent,
} from "@/lib/communities/content-removal";
import { logCommunityActivity } from "@/lib/communities/manager-role";
import {
  REPORT_CONTENT_TYPE_VALUES,
  reportReasonLabel,
  type ReportableContentType,
} from "@/lib/communities/report-reasons";
import {
  CONTENT_REMOVAL_TYPES,
  communityHref,
  contentRestoredNotice,
  deferNotification,
  eventHref,
  reportReviewedNotice,
  reportedRemovalNotice,
  resourceHref,
  showcaseHref,
  threadHref,
  type NotificationEntityType,
} from "@/lib/notifications";

/**
 * Admin view of one reported post — the detail page behind every queue row.
 *
 * GET returns everything a reviewer needs in one payload: the post itself
 * (title, body, media, poll, event details, live engagement counts), its
 * author and community (so the page can link to /admin/users/[id] and
 * /admin/communities/[id]), every report with its reporter, and the active
 * removal if one exists. Deleted posts are previewed from the removal
 * snapshot, so the reviewer can still see what was taken down.
 *
 * POST is the action surface, keyed by content (not by report) because one
 * takedown answers every open report on the post:
 *
 *   - `remove`  — takes the post down through the shared removal path,
 *     snapshots it for undo, closes every pending report and notifies the
 *     author (with the reason) plus each reporter.
 *   - `dismiss` — closes the given reports (or every pending report on the
 *     post); the post stays up and nobody is notified. Responds with the
 *     dismissed ids so the client's undo toast can `reopen` them.
 *   - `reopen`  — the dismiss undo: puts dismissed reports back to pending.
 *   - `restore` — the removal undo: re-inserts the post and its discussion
 *     with the same ids, re-opens the reports that were closed as removed,
 *     and tells the author their post is back.
 */

type Db = ReturnType<typeof createServiceClient>;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ACTIONS = new Set(["remove", "dismiss", "reopen", "restore"]);

interface ReportRow {
  id: string;
  reporter_id: string;
  content_type: string;
  content_id: string;
  community_id: string | null;
  content_author_id: string | null;
  content_title: string | null;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

interface RemovalRow {
  id: string;
  content_type: string;
  content_id: string;
  community_id: string | null;
  content_author_id: string | null;
  content_title: string | null;
  snapshot: unknown;
  removed_by: string | null;
  removed_at: string;
  undone_at: string | null;
}

/** Parse + validate the URL pair; null when it cannot name a report target. */
function parseTarget(
  contentType: string,
  contentId: string,
): { kind: ReportableContentType; id: string } | null {
  if (!REPORT_CONTENT_TYPE_VALUES.has(contentType)) return null;
  if (!UUID_PATTERN.test(contentId)) return null;
  return { kind: contentType as ReportableContentType, id: contentId };
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

interface AttachmentPreview {
  url: string;
  type: string;
  name: string | null;
  poster: string | null;
}

function normalizeAttachments(value: unknown): AttachmentPreview[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.url !== "string") return [];
    return [
      {
        url: record.url,
        type: typeof record.type === "string" ? record.type : "",
        name: typeof record.name === "string" ? record.name : null,
        poster: typeof record.poster === "string" ? record.poster : null,
      },
    ];
  });
}

function normalizePoll(value: unknown): { question: string; options: string[] } | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.question !== "string" || !Array.isArray(record.options)) return null;
  const options = record.options.filter((option): option is string => typeof option === "string");
  if (!record.question.trim() || options.length < 2) return null;
  return { question: record.question, options };
}

/** Engagement counters shown beside the preview, one query per relevant table. */
const STAT_MEASURES: Record<
  ReportableContentType,
  Array<{ table: string; column: string; key: string }>
> = {
  thread: [
    { table: "thread_comments", column: "thread_id", key: "comments" },
    { table: "thread_likes", column: "thread_id", key: "likes" },
    { table: "thread_saves", column: "thread_id", key: "saves" },
  ],
  showcase: [
    { table: "showcase_comments", column: "post_id", key: "comments" },
    { table: "showcase_likes", column: "post_id", key: "likes" },
    { table: "showcase_saves", column: "post_id", key: "saves" },
  ],
  resource: [
    { table: "resource_comments", column: "resource_id", key: "comments" },
    { table: "resource_saves", column: "resource_id", key: "saves" },
    { table: "resource_bookmarks", column: "resource_id", key: "bookmarks" },
  ],
  event: [
    { table: "event_comments", column: "event_id", key: "comments" },
    { table: "event_rsvps", column: "event_id", key: "rsvps" },
    { table: "event_likes", column: "event_id", key: "likes" },
    { table: "event_saves", column: "event_id", key: "saves" },
  ],
};

async function loadStats(db: Db, kind: ReportableContentType, id: string) {
  const dynamic = db as unknown as SupabaseClient;
  const entries = await Promise.all(
    STAT_MEASURES[kind].map(async (measure) => {
      const { count } = await dynamic
        .from(measure.table)
        .select("*", { count: "exact", head: true })
        .eq(measure.column, id);
      return [measure.key, count ?? 0] as const;
    }),
  );
  return Object.fromEntries(entries);
}

interface PersonRow {
  id: string;
  name: string;
  email: string;
}

/** Names + avatars for everyone the page mentions, in two queries. */
async function loadPeople(db: Db, ids: string[]) {
  if (!ids.length) {
    return {
      people: new Map<string, PersonRow>(),
      avatars: new Map<string, string | null>(),
    };
  }
  const [{ data: people }, { data: avatarRows }] = await Promise.all([
    db.from("users").select("id, name, email").in("id", ids),
    db.from("designer_profiles").select("user_id, avatar_url").in("user_id", ids),
  ]);
  return {
    people: new Map(((people ?? []) as PersonRow[]).map((person) => [person.id, person])),
    avatars: new Map(
      (avatarRows ?? []).map((row: { user_id: string; avatar_url: string | null }) => [
        row.user_id,
        row.avatar_url,
      ]),
    ),
  };
}

function personFor(
  id: string | null,
  people: Map<string, PersonRow>,
  avatars: Map<string, string | null>,
) {
  if (!id) return null;
  const person = people.get(id);
  return {
    id,
    name: person?.name ?? "Unknown member",
    email: person?.email ?? null,
    avatar_url: avatars.get(id) ?? null,
  };
}

/** The live page a restored post should link to; null when we cannot build one. */
function restoredHref(
  kind: ReportableContentType,
  communityId: string | null,
  contentId: string,
): string {
  if (!communityId) return "/dashboard/notifications";
  switch (kind) {
    case "thread":
      return threadHref(communityId, contentId);
    case "showcase":
      return showcaseHref(communityId, contentId);
    case "resource":
      return resourceHref(communityId, contentId);
    case "event":
      return eventHref(communityId, contentId);
  }
}

async function loadReportsAndRemoval(db: Db, kind: ReportableContentType, id: string) {
  const [reportsResult, removalResult] = await Promise.all([
    db
      .from("content_reports")
      .select("*")
      .eq("content_type", kind)
      .eq("content_id", id)
      .order("created_at", { ascending: false }),
    db
      .from("content_removals")
      .select("*")
      .eq("content_type", kind)
      .eq("content_id", id)
      .is("undone_at", null)
      .order("removed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  return {
    reports: (reportsResult.data ?? []) as ReportRow[],
    reportsError: reportsResult.error,
    removal: (removalResult.data ?? null) as unknown as RemovalRow | null,
    removalError: removalResult.error,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ contentType: string; contentId: string }> },
) {
  try {
    await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const { contentType, contentId } = await params;
  const target = parseTarget(contentType, contentId);
  if (!target) {
    return NextResponse.json({ error: "Unknown reported content." }, { status: 404 });
  }
  const { kind, id } = target;

  const db = createServiceClient();
  const { reports, reportsError, removal } = await loadReportsAndRemoval(db, kind, id);
  if (reportsError) {
    console.error("[admin/reports/detail] reports", reportsError);
    return NextResponse.json({ error: "Failed to load the reports." }, { status: 500 });
  }
  if (!reports.length && !removal) {
    return NextResponse.json({ error: "No reports found for this post." }, { status: 404 });
  }

  const { data: liveData } = await loadContentRow(db, kind, id);
  const live = (liveData ?? null) as unknown as Record<string, unknown> | null;
  // The snapshot keeps a removed post previewable — and restorable.
  const snapshotContent =
    ((removal?.snapshot as { content?: Record<string, unknown> } | null)?.content ?? null) as
      | Record<string, unknown>
      | null;
  const preview = live ?? snapshotContent;

  const authorId =
    str(preview?.user_id) ?? reports[0]?.content_author_id ?? removal?.content_author_id ?? null;
  const communityId =
    str(preview?.community_id) ?? reports[0]?.community_id ?? removal?.community_id ?? null;

  const ids = new Set<string>();
  if (authorId) ids.add(authorId);
  for (const report of reports) ids.add(report.reporter_id);
  if (removal?.removed_by) ids.add(removal.removed_by);

  const [{ people, avatars }, communityResult, stats] = await Promise.all([
    loadPeople(db, [...ids]),
    communityId
      ? db.from("communities").select("id, name").eq("id", communityId).maybeSingle()
      : Promise.resolve({ data: null }),
    live ? loadStats(db, kind, id) : Promise.resolve({} as Record<string, number>),
  ]);

  const counts = {
    total: reports.length,
    pending: reports.filter((report) => report.status === "pending").length,
    removed: reports.filter((report) => report.status === "removed").length,
    dismissed: reports.filter((report) => report.status === "dismissed").length,
    reporters: new Set(reports.map((report) => report.reporter_id)).size,
  };

  return NextResponse.json({
    content: {
      type: kind,
      id,
      exists: Boolean(live),
      from_snapshot: !live && Boolean(snapshotContent),
      title: str(preview?.title),
      description: str(preview?.description),
      created_at: str(preview?.created_at),
      is_public: typeof preview?.is_public === "boolean" ? preview.is_public : null,
      category: str(preview?.category),
      tags: stringArray(preview?.tags),
      links: stringArray(preview?.links),
      url: str(preview?.url),
      resource_type: str(preview?.resource_type),
      image_url: str(preview?.image_url),
      cover_image_url: str(preview?.cover_image_url),
      attachments: normalizeAttachments(preview?.attachments),
      poll: kind === "thread" ? normalizePoll(preview?.poll) : null,
      event:
        kind === "event"
          ? {
              event_date: str(preview?.event_date),
              end_date: str(preview?.end_date),
              location: str(preview?.location),
              meet_link: str(preview?.meet_link),
              is_online: typeof preview?.is_online === "boolean" ? preview.is_online : null,
              max_attendees:
                typeof preview?.max_attendees === "number" ? preview.max_attendees : null,
            }
          : null,
      stats,
    },
    author: personFor(authorId, people, avatars),
    community: communityResult.data
      ? { id: (communityResult.data as { id: string }).id, name: (communityResult.data as { name: string }).name }
      : null,
    reports: reports.map((report) => ({
      id: report.id,
      reason: report.reason,
      reason_label: reportReasonLabel(report.reason),
      details: report.details,
      status: report.status,
      created_at: report.created_at,
      resolved_at: report.resolved_at,
      reporter: personFor(report.reporter_id, people, avatars),
    })),
    counts,
    removal: removal
      ? {
          id: removal.id,
          removed_at: removal.removed_at,
          removed_by: removal.removed_by,
          removed_by_name: removal.removed_by ? people.get(removal.removed_by)?.name ?? null : null,
          undone_at: removal.undone_at,
        }
      : null,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ contentType: string; contentId: string }> },
) {
  let session;
  try {
    session = await requireSession("admin");
  } catch (error) {
    return error as Response;
  }

  const { contentType, contentId } = await params;
  const target = parseTarget(contentType, contentId);
  if (!target) {
    return NextResponse.json({ error: "Unknown reported content." }, { status: 404 });
  }
  const { kind, id } = target;
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

  const requestedReportIds = Array.isArray(body.reportIds)
    ? body.reportIds
        .filter((value): value is string => typeof value === "string")
        .slice(0, 200)
    : null;

  const db = createServiceClient();
  const { reports, reportsError, removal } = await loadReportsAndRemoval(db, kind, id);
  if (reportsError) {
    console.error("[admin/reports/detail] reports", reportsError);
    return NextResponse.json({ error: "Failed to load the reports." }, { status: 500 });
  }

  const now = new Date().toISOString();

  // ── Dismiss ─────────────────────────────────────────────────────────────
  if (action === "dismiss") {
    let query = db
      .from("content_reports")
      .update({ status: "dismissed", resolved_at: now, resolved_by: adminId })
      .eq("content_type", kind)
      .eq("content_id", id)
      .eq("status", "pending");
    // No ids = dismiss every pending report on the post (queue row action).
    if (requestedReportIds?.length) query = query.in("id", requestedReportIds);

    const { data: dismissed, error: dismissError } = await query.select("id");
    if (dismissError) {
      console.error("[admin/reports/detail] dismiss", dismissError);
      return NextResponse.json({ error: "Failed to dismiss the reports." }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      action: "dismiss",
      dismissedReportIds: (dismissed ?? []).map((row: { id: string }) => row.id),
    });
  }

  // ── Reopen (undo a dismiss) ─────────────────────────────────────────────
  if (action === "reopen") {
    if (!requestedReportIds?.length) {
      return NextResponse.json({ error: "No reports to reopen." }, { status: 422 });
    }
    const { data: reopened, error: reopenError } = await db
      .from("content_reports")
      .update({ status: "pending", resolved_at: null, resolved_by: null })
      .in("id", requestedReportIds)
      .eq("content_type", kind)
      .eq("content_id", id)
      .eq("status", "dismissed")
      .select("id");
    if (reopenError) {
      console.error("[admin/reports/detail] reopen", reopenError);
      return NextResponse.json({ error: "Failed to reopen the reports." }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      action: "reopen",
      reopenedReportIds: (reopened ?? []).map((row: { id: string }) => row.id),
    });
  }

  // ── Restore (undo a removal) ────────────────────────────────────────────
  if (action === "restore") {
    if (!removal) {
      return NextResponse.json({ error: "Nothing to restore." }, { status: 409 });
    }
    const restored = await restoreRemovedContent(db, { removalId: removal.id, undoneBy: adminId });
    if (!restored.ok) {
      console.error("[admin/reports/detail] restore", restored.error);
      return NextResponse.json({ error: "Failed to restore the post." }, { status: 500 });
    }

    // The post is back up, so the reports that closed with the removal are
    // open questions again.
    const { data: reopened } = await db
      .from("content_reports")
      .update({ status: "pending", resolved_at: null, resolved_by: null })
      .eq("content_type", kind)
      .eq("content_id", id)
      .eq("status", "removed")
      .select("id");

    const communityId = removal.community_id;
    if (restored.restored && restored.content) {
      const notice = contentRestoredNotice(kind, restored.content.title ?? removal.content_title);
      deferNotification({
        userId: restored.content.userId,
        actorId: adminId,
        communityId,
        type: "content_restored",
        entityType: kind as NotificationEntityType,
        entityId: id,
        title: () => notice.title,
        body: notice.body,
        href: restoredHref(kind, communityId, id),
      });
      if (communityId) {
        await logCommunityActivity(db, {
          communityId,
          actorId: adminId,
          actorRole: "platform",
          action: "content_restored",
          targetUserId: restored.content.userId,
          details: { content_type: kind, content_id: id, removal_id: removal.id },
        });
      }
    }

    return NextResponse.json({
      ok: true,
      action: "restore",
      restored: restored.restored,
      reopenedReportIds: (reopened ?? []).map((row: { id: string }) => row.id),
    });
  }

  // ── Remove ──────────────────────────────────────────────────────────────
  if (!reports.length) {
    return NextResponse.json({ error: "No reports found for this post." }, { status: 404 });
  }

  const { data: liveData } = await loadContentRow(db, kind, id);
  const live = (liveData ?? null) as unknown as Record<string, unknown> | null;
  const communityId = str(live?.community_id) ?? reports[0].community_id ?? null;
  const scope = communityId ?? PUBLIC_CONTENT_SCOPE;

  const removalResult = await removeCommunityContent(db, {
    kind,
    id,
    scope,
    snapshot: { removedBy: adminId },
  });
  if (!removalResult.ok) {
    console.error("[admin/reports/detail] removal", removalResult.error);
    return NextResponse.json({ error: "Failed to remove the post." }, { status: 500 });
  }

  // One takedown answers every open report on this post.
  const { data: resolved, error: resolveError } = await db
    .from("content_reports")
    .update({ status: "removed", resolved_at: now, resolved_by: adminId })
    .eq("content_type", kind)
    .eq("content_id", id)
    .eq("status", "pending")
    .select("id, reporter_id");
  if (resolveError) {
    console.error("[admin/reports/detail] resolve", resolveError);
    return NextResponse.json({ error: "Failed to close the reports." }, { status: 500 });
  }

  const resolvedRows = (resolved ?? []) as Array<{ id: string; reporter_id: string }>;
  const pendingReports = reports.filter((report) => report.status === "pending");
  const reasonSource = pendingReports[0] ?? reports[0];
  const contentTitle = reasonSource?.content_title ?? removalResult.content?.title ?? null;

  // The author hears why their post came down — the report reason, not just
  // that it was removed. Skipped when the post was already gone.
  if (removalResult.removed && removalResult.content) {
    const notice = reportedRemovalNotice(kind, reportReasonLabel(reasonSource.reason), contentTitle);
    deferNotification({
      userId: removalResult.content.userId,
      actorId: adminId,
      communityId,
      type: CONTENT_REMOVAL_TYPES[kind],
      entityType: kind as NotificationEntityType,
      entityId: id,
      title: () => notice.title,
      body: notice.body,
      href: communityId ? communityHref(communityId) : "/dashboard/notifications",
    });
  }

  // Every reporter who flagged this post gets the thank-you.
  const thanks = reportReviewedNotice(kind, removalResult.removed);
  const reporterIds = [...new Set(resolvedRows.map((row) => row.reporter_id))];
  for (const reporterId of reporterIds) {
    deferNotification({
      userId: reporterId,
      actorId: adminId,
      communityId,
      type: "report_reviewed",
      entityType: kind as NotificationEntityType,
      entityId: id,
      title: () => thanks.title,
      body: thanks.body,
      href: communityId ? communityHref(communityId) : "/dashboard/notifications",
    });
  }

  // Best-effort audit trail so the community's managers see the platform
  // action, mirroring the manager delete flow's activity rows.
  if (communityId && removalResult.removed) {
    await logCommunityActivity(db, {
      communityId,
      actorId: adminId,
      actorRole: "platform",
      action: CONTENT_REMOVAL_TYPES[kind],
      targetUserId: removalResult.content?.userId ?? reports[0].content_author_id,
      details: {
        content_type: kind,
        content_id: id,
        reason: reasonSource?.reason ?? null,
        report_ids: resolvedRows.map((row) => row.id),
      },
    });
  }

  return NextResponse.json({
    ok: true,
    action: "remove",
    removalId: removalResult.removalId,
    removed: removalResult.removed,
    resolvedReportIds: resolvedRows.map((row) => row.id),
  });
}
