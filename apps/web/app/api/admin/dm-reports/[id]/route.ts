import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSession, type SessionPayload } from "@/lib/auth/session";
import { recordAdminAudit } from "@/lib/moderation/admin-audit";
import { setUserBlocked } from "@/lib/auth/session-registry";
import { revokeRealtimeSessions } from "@/lib/realtime/revoke";
import { createNotification } from "@/lib/notifications";
import { createServiceClient } from "@/lib/supabase/service";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ACTIONS = new Set(["reviewed", "dismissed", "reopen", "warn", "suspend", "ban"]);

/**
 * POST /api/admin/dm-reports/[id]  { action: "reviewed" | "dismissed" | "reopen" }
 *
 * The review surface for one DM report. `reviewed` and `dismissed` close it
 * (the distinct states keep "we acted on this" apart from "nothing to do");
 * `reopen` is the way back. No member-facing notifications — a DM report is
 * between the reporter and the moderation queue.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let session: SessionPayload;
  try {
    session = await requireSession("admin");
  } catch (error) {
    return error as Response;
  }
  const adminId = session.userId ?? null;

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: "Unknown report." }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as
    | { action?: unknown; reason?: unknown; days?: unknown }
    | null;
  const action = typeof body?.action === "string" ? body.action : "";
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 2000) : null;
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ error: "Unknown action." }, { status: 422 });
  }

  const db = createServiceClient();
  const { data: report } = (await (db as unknown as SupabaseClient)
    .from("dm_reports")
    .select("id, reported_user_id, status, reporter_id, conversation_id, reason, message_snapshot, details")
    .eq("id", id)
    .maybeSingle()) as {
    data: {
      id: string;
      reported_user_id: string | null;
      status: string;
      reporter_id: string | null;
      conversation_id: string | null;
      reason: string;
      message_snapshot: unknown;
      details: string | null;
    } | null;
  };
  if (!report) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  if (action === "warn" || action === "suspend" || action === "ban") {
    if (!report.reported_user_id) {
      return NextResponse.json({ error: "The reported account no longer exists." }, { status: 409 });
    }
    if (!reason) {
      return NextResponse.json({ error: "A reason is required for this action." }, { status: 422 });
    }

    if (action === "suspend") {
      const days = typeof body?.days === "number" ? Math.floor(body.days) : Number(body?.days);
      if (!Number.isFinite(days) || days < 1 || days > 30) {
        return NextResponse.json({ error: "Suspension must be between 1 and 30 days." }, { status: 422 });
      }
      const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
      const { error: suspendError } = await (db as unknown as SupabaseClient).rpc("set_user_suspended", {
        p_user_id: report.reported_user_id,
        p_until: until,
        p_reason: `dm_report: ${reason}`,
      });
      if (suspendError) {
        console.error("[admin/dm-reports] suspend failed:", suspendError);
        return NextResponse.json({ error: "Failed to suspend the account." }, { status: 500 });
      }
    } else if (action === "ban") {
      try {
        await setUserBlocked(report.reported_user_id, true, "dm_report");
      } catch (banError) {
        console.error("[admin/dm-reports] ban failed:", banError);
        return NextResponse.json({ error: "Failed to ban the account." }, { status: 500 });
      }
    }

    await revokeRealtimeSessions({ userId: report.reported_user_id, all: true }).catch((error) => {
      console.error("[admin/dm-reports] realtime revocation failed:", error);
    });

    const { error: reportError } = await db
      .from("dm_reports")
      .update({ status: "reviewed", resolved_at: new Date().toISOString(), resolved_by: adminId })
      .eq("id", id);
    if (reportError) {
      console.error("[admin/dm-reports] action report update failed:", reportError);
      return NextResponse.json({ error: "The account was actioned, but the report could not be closed." }, { status: 500 });
    }

    await recordAdminAudit(db, session, {
      action:
        action === "warn" ? "warn_user" : action === "suspend" ? "suspend_user" : "ban_user",
      targetType: "dm_report",
      targetId: id,
      reportId: null,
      subjectUserId: report.reported_user_id,
      previousState: { status: report.status, reason: report.reason },
      newState: {
        status: "reviewed",
        action,
        reason,
        days: action === "suspend" ? body?.days ?? null : null,
        dm_report_id: id,
        snapshot_messages: Array.isArray(report.message_snapshot) ? report.message_snapshot.length : 0,
      },
      reason,
    });

    await createNotification(db, {
      userId: report.reported_user_id,
      actorId: null,
      communityId: null,
      type: "moderation_action",
      entityType: "moderation",
      entityId: id,
      title:
        action === "warn"
          ? "A moderator warned your account"
          : action === "suspend"
            ? "Your account was suspended"
            : "Your account was banned",
      body:
        action === "warn"
          ? `A report about your direct messages was reviewed: ${reason}`
          : `A report about your direct messages was reviewed: ${reason}. Contact hello@uxcommunity.in if you want this reviewed.`,
      href: "/dashboard",
    }).catch((error) => {
      console.error("[admin/dm-reports] member notification failed:", error);
    });

    return NextResponse.json({ ok: true, action, status: "reviewed" });
  }

  const patch =
    action === "reopen"
      ? { status: "pending", resolved_at: null, resolved_by: null }
      : { status: action, resolved_at: new Date().toISOString(), resolved_by: adminId };

  const { data, error } = (await db
    .from("dm_reports")
    .update(patch)
    .eq("id", id)
    .select("id, status")
    .maybeSingle()) as unknown as {
    data: { id: string; status: string } | null;
    error: unknown;
  };

  if (error) {
    console.error("[admin/dm-reports] update error:", error);
    return NextResponse.json({ error: "Failed to update the report." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Report not found." }, { status: 404 });
  }

  const auditAction =
    action === "reopen"
      ? "reopen_dm_report"
      : action === "dismissed"
        ? "dismiss_report"
        : "review_dm_report";

  await recordAdminAudit(db, session, {
    action: auditAction,
    targetType: "dm_report",
    targetId: id,
    reportId: null,
    subjectUserId: report.reported_user_id ?? null,
    previousState: { status: report.status },
    newState: { status: data.status, reason },
    reason,
  });

  return NextResponse.json({ ok: true, action, status: data.status });
}
