import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth/session";
import { createServiceClient } from "@/lib/supabase/service";
import { setUserBlocked } from "@/lib/auth/session-registry";
import { createNotification } from "@/lib/notifications";
import { sendModerationAppealDecisionEmail } from "@/lib/email";
import { recordModerationAction, type ModerationAuditAction } from "@/lib/moderation/audit";

const NOTE_MAX_LENGTH = 500;

interface AppealRecord {
  id: string;
  report_id: string | null;
  user_id: string | null;
  target_type: string;
  target_id: string;
  message: string;
  status: "pending" | "granted" | "denied";
}

interface ReportRecord {
  id: string;
  target_type: string;
  target_id: string;
  context_id: string | null;
  community_id: string | null;
  target_author_id: string | null;
  reason: string;
  status: string;
}

/**
 * Review one appeal.
 *
 * Granting reverses what the audited action did where that is safe:
 *   ban_user        → unblock the account (a fresh sign-in is still required),
 *   suspend_user    → lift the suspension,
 *   hide_community  → make the community active again,
 *   deactivate_job  → reopen the posting and clear its moderation flag.
 *
 * A deleted comment/message cannot be restored — the removal is recorded in
 * the audit log and the member is told so. The decision itself is still
 * recorded, so the outcome is visible and appealable history is complete.
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
    | { action?: string; note?: string }
    | null;
  const action = body?.action;
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, NOTE_MAX_LENGTH) : "";

  if (action !== "grant" && action !== "deny") {
    return NextResponse.json({ error: "Unknown action." }, { status: 422 });
  }

  const db = createServiceClient();

  const { data: appeal } = (await (db as unknown as SupabaseClient)
    .from("moderation_appeals")
    .select("id, report_id, user_id, target_type, target_id, message, status")
    .eq("id", id)
    .maybeSingle()) as { data: AppealRecord | null };

  if (!appeal) {
    return NextResponse.json({ error: "Appeal not found." }, { status: 404 });
  }
  if (appeal.status !== "pending") {
    return NextResponse.json({ error: "This appeal has already been reviewed." }, { status: 409 });
  }
  if (!appeal.report_id) {
    return NextResponse.json(
      { error: "The report behind this appeal is unavailable." },
      { status: 404 },
    );
  }

  const { data: report } = (await (db as unknown as SupabaseClient)
    .from("interaction_reports")
    .select(
      "id, target_type, target_id, context_id, community_id, target_author_id, reason, status",
    )
    .eq("id", appeal.report_id)
    .maybeSingle()) as { data: ReportRecord | null };

  if (!report) {
    return NextResponse.json({ error: "The report behind this appeal is unavailable." }, { status: 404 });
  }

  const { data: lastAction } = (await (db as unknown as SupabaseClient)
    .from("moderation_audit_log")
    .select("action, new_state, previous_state")
    .eq("report_id", report.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()) as {
    data:
      | {
          action: ModerationAuditAction;
          new_state: Record<string, unknown> | null;
          previous_state: Record<string, unknown> | null;
        }
      | null;
  };

  let restored: string | null = null;
  if (action === "grant" && lastAction) {
    try {
      restored = await restoreDecision(db, lastAction.action, report);
    } catch (error) {
      console.error("[admin/moderation-appeals] restore failed:", error);
      return NextResponse.json(
        { error: "The decision could not be reversed. The appeal is still pending." },
        { status: 500 },
      );
    }
  }

  const appealStatus = action === "grant" ? "granted" : "denied";
  const { error: appealError } = await (db as unknown as SupabaseClient)
    .from("moderation_appeals")
    .update({
      status: appealStatus,
      resolution_note: note || null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: session.userId ?? null,
    })
    .eq("id", appeal.id)
    .eq("status", "pending");

  if (appealError) {
    console.error("[admin/moderation-appeals] update failed:", appealError);
    return NextResponse.json({ error: "Failed to update the appeal." }, { status: 500 });
  }

  await recordModerationAction(db, {
    moderatorId: session.userId ?? null,
    moderatorSid: session.sid,
    action: action === "grant" ? "grant_appeal" : "deny_appeal",
    targetType: report.target_type,
    targetId: report.target_id,
    reportId: report.id,
    subjectUserId: report.target_author_id,
    previousState: { appeal_status: "pending", moderation_action: lastAction?.action ?? null },
    newState: { appeal_status: appealStatus, restored },
    reason: note || null,
  });

  if (appeal.user_id) {
    await createNotification(db, {
      userId: appeal.user_id,
      actorId: null,
      communityId: report.community_id,
      type: "appeal_reviewed",
      // Keyed by the report, so the outcome is never folded into another unread
      // notification on the same target.
      entityType: "moderation",
      entityId: report.id,
      title: action === "grant" ? "Your appeal was granted" : "Your appeal was denied",
      body:
        action === "grant"
          ? restored === "content_deleted"
            ? "We reviewed your appeal and changed our decision. Removed content cannot be restored automatically; any account or community restriction has been lifted."
            : restored
              ? "We reviewed your appeal and restored your access or listing."
              : "We reviewed your appeal and changed our decision."
          : note
            ? `Our original decision stands: ${note}`
            : "We reviewed your appeal and our original decision stands.",
      href: "/dashboard/appeals",
    });

    // A suspended/banned member cannot read the in-app notice. The decision
    // email is the durable delivery path; failure never rolls back the review.
    try {
      const { data: subject } = await db
        .from("users")
        .select("email, name")
        .eq("id", appeal.user_id)
        .maybeSingle();
      const email = subject?.email?.trim();
      if (email) {
        await sendModerationAppealDecisionEmail(
          email,
          subject?.name?.trim() || "there",
          action === "grant",
          note || null,
        );
      }
    } catch (emailError) {
      console.error("[admin/moderation-appeals] decision email failed:", emailError);
    }
  }

  return NextResponse.json({ success: true, status: appealStatus, restored });
}

/**
 * Reverse the audited action where possible. Returns a short marker used in
 * the audit row and the member notification, or null when there was nothing
 * to undo (a warning, or a deleted comment).
 */
async function restoreDecision(
  db: ReturnType<typeof createServiceClient>,
  action: ModerationAuditAction,
  report: ReportRecord,
): Promise<string | null> {
  const subject = report.target_author_id;

  switch (action) {
    case "ban_user": {
      if (!subject) return null;
      await setUserBlocked(subject, false, "appeal_granted");
      return "account_unblocked";
    }

    case "suspend_user": {
      if (!subject) return null;
      const { error } = await (db as unknown as SupabaseClient).rpc("set_user_suspended", {
        p_user_id: subject,
        p_until: null,
        p_reason: "appeal_granted",
      });
      if (error) throw new Error(`set_user_suspended failed: ${error.message}`);
      return "suspension_lifted";
    }

    case "hide_community": {
      const { error } = await db
        .from("communities")
        .update({ is_active: true })
        .eq("id", report.target_id);
      if (error) throw new Error(`community restore failed: ${error.message}`);
      return "community_restored";
    }

    case "deactivate_job": {
      const { error } = await (db as unknown as SupabaseClient)
        .from("job_posts")
        .update({ status: "open", moderated_at: null, moderation_note: null })
        .eq("id", report.target_id);
      if (error) throw new Error(`job restore failed: ${error.message}`);
      return "job_reopened";
    }

    case "remove_content":
      return "content_deleted";

    case "warn_user":
      return null;

    default:
      return null;
  }
}
