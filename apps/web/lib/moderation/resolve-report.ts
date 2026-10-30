import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InteractionReportType } from "@/lib/communities/report-reasons";
import { reportReasonLabel } from "@/lib/communities/report-reasons";
import { setUserBlocked } from "@/lib/auth/session-registry";
import { revokeRealtimeSessions } from "@/lib/realtime/revoke";
import { logEvent } from "@/lib/observability/log";
import type { ServiceClient } from "@/lib/supabase/service";
import { recordModerationAction } from "./audit";
import {
  actionNeedsSubject,
  allowedModerationActions,
  MAX_SUSPENSION_DAYS,
  type ModerationActionId,
} from "./action-catalog";
import { removeInteractionContent } from "./interaction-reports";
import {
  interactionEntityType,
  interactionTargetLabel,
  isRemovableInteraction,
} from "./interaction-targets";

/**
 * The moderator action engine behind the unified queue.
 *
 * One place decides what each action means for each target type, records it in
 * the audit log and tells the two people involved:
 *
 *   the reporter — that the report was reviewed (never who was actioned, and
 *                  never anything about the reporter's identity);
 *   the subject  — what was removed/restricted and why, plus where to appeal.
 *
 * Safety rules encoded here, not in the UI:
 *   • a job listing is CLOSED and flagged, never deleted — its applications
 *     and applicant data are untouched;
 *   • a community is hidden (`is_active = false`), so membership, ownership
 *     and content all survive;
 *   • a profile is never deleted from the queue;
 *   • evidence snapshots live on the report row and are never removed by any
 *     action.
 */

export interface ModerationReport {
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
  reason: string;
  details: string | null;
  status: string;
  target_snapshot: Record<string, unknown> | null;
}

export type ResolveOutcome =
  | { ok: true; status: "removed" | "actioned" | "dismissed" }
  | { ok: false; status: number; error: string };

interface ResolveInput {
  db: ServiceClient;
  report: ModerationReport;
  action: ModerationActionId;
  note: string | null;
  suspendDays: number | null;
  moderatorId: string | null;
  moderatorSid: string;
}

/** "Removed for: Scam or fraudulent recruitment — <note>". */
function reasonLine(report: ModerationReport, note: string | null): string {
  const reason = reportReasonLabel(report.reason);
  return note ? `${reason} — ${note}` : reason;
}

function subjectHref(): string {
  // Every moderation notice points at the appeal surface: it both explains the
  // decision and is the one place the member can respond to it.
  return "/dashboard/appeals";
}

function contentNoun(report: ModerationReport): string {
  switch (report.target_type) {
    case "community_message":
      return "message";
    case "community":
      return "community";
    case "job":
      return "job listing";
    default:
      return "content";
  }
}

export async function resolveModerationReport({
  db,
  report,
  action,
  note,
  suspendDays,
  moderatorId,
  moderatorSid,
}: ResolveInput): Promise<ResolveOutcome> {
  const allowed = allowedModerationActions(report.target_type);
  if (!allowed.includes(action)) {
    return { ok: false, status: 422, error: "That action is not available for this report." };
  }
  if (actionNeedsSubject(action) && !report.target_author_id) {
    return {
      ok: false,
      status: 422,
      error: "This target has no account to act on. Dismiss the report instead.",
    };
  }
  if (action === "suspend_user") {
    const days = suspendDays ?? 0;
    if (!Number.isInteger(days) || days < 1 || days > MAX_SUSPENSION_DAYS) {
      return {
        ok: false,
        status: 422,
        error: `Choose a suspension length between 1 and ${MAX_SUSPENSION_DAYS} days.`,
      };
    }
  }

  const reason = reasonLine(report, note);
  const entityType = interactionEntityType(report.target_type);
  const entityId = report.context_id ?? report.target_id;
  const targetLabel = interactionTargetLabel(report.target_type);

  let status: "removed" | "actioned" | "dismissed" = "dismissed";
  let auditAction:
    | "dismiss_report"
    | "remove_content"
    | "hide_community"
    | "deactivate_job"
    | "warn_user"
    | "suspend_user"
    | "ban_user" = "dismiss_report";
  let previousState: Record<string, unknown> = { report_status: report.status };
  let newState: Record<string, unknown> = {};
  let subjectNotice: { title: string; body: string } | null = null;
  let subjectUntil: string | null = null;

  switch (action) {
    case "dismiss": {
      status = "dismissed";
      auditAction = "dismiss_report";
      newState = { report_status: "dismissed" };
      break;
    }

    case "remove": {
      if (!isRemovableInteraction(report.target_type)) {
        return {
          ok: false,
          status: 422,
          error: "This report type is resolved with another action.",
        };
      }
      const removal = await removeInteractionContent(db, report.target_type, report.target_id);
      if (!removal.ok) {
        return { ok: false, status: 500, error: "Failed to remove the content." };
      }
      status = "removed";
      auditAction = "remove_content";
      previousState = { content: "present", report_status: report.status };
      newState = { content: "deleted", report_status: "removed" };
      subjectNotice = {
        title: `Your ${targetLabel} was removed`,
        body: `Removed for: ${reason}. You can appeal this decision.`,
      };
      break;
    }

    case "hide_community": {
      const { data: community } = await db
        .from("communities")
        .select("id, name, is_active")
        .eq("id", report.target_id)
        .maybeSingle();
      if (!community) {
        return { ok: false, status: 404, error: "This community no longer exists." };
      }
      if (community.is_active) {
        const { error } = await db
          .from("communities")
          .update({ is_active: false })
          .eq("id", report.target_id);
        if (error) {
          console.error("[moderation] hide community failed:", error);
          return { ok: false, status: 500, error: "Failed to hide the community." };
        }
      }
      status = "removed";
      auditAction = "hide_community";
      previousState = { is_active: community.is_active, report_status: report.status };
      newState = { is_active: false, report_status: "removed" };
      subjectNotice = {
        title: "Your community was hidden",
        body: `Hidden for: ${reason}. Members and content are kept — you can appeal this decision.`,
      };
      break;
    }

    case "deactivate_job": {
      const jobs = (db as unknown as SupabaseClient).from("job_posts");
      const { data: job } = (await jobs
        .select("id, title, status, moderated_at")
        .eq("id", report.target_id)
        .maybeSingle()) as {
        data: { id: string; title: string; status: string; moderated_at: string | null } | null;
      };
      if (!job) {
        return { ok: false, status: 404, error: "This job listing no longer exists." };
      }
      if (!job.moderated_at) {
        const { error } = await jobs
          .update({
            status: "closed",
            moderated_at: new Date().toISOString(),
            moderation_note: note,
          })
          .eq("id", report.target_id);
        if (error) {
          console.error("[moderation] deactivate job failed:", error);
          return { ok: false, status: 500, error: "Failed to deactivate the job." };
        }
      }
      status = "removed";
      auditAction = "deactivate_job";
      previousState = { status: job.status, moderated_at: job.moderated_at };
      newState = { status: "closed", moderated_at: new Date().toISOString() };
      subjectNotice = {
        title: "Your job listing was deactivated",
        body: `Removed for: ${reason}. Applications and applicant data are kept — you can appeal this decision.`,
      };
      break;
    }

    case "warn_user": {
      status = "actioned";
      auditAction = "warn_user";
      newState = { warning_issued: true };
      subjectNotice = {
        title: `Warning about your ${contentNoun(report)}`,
        body: `A moderator reviewed a report about your ${contentNoun(report)}: ${reason}. Repeated violations can lead to a suspension or ban. You can appeal this decision.`,
      };
      break;
    }

    case "suspend_user": {
      const until = new Date(Date.now() + (suspendDays ?? 0) * 24 * 60 * 60 * 1000);
      subjectUntil = until.toISOString();
      try {
        await suspendUser(report.target_author_id!, subjectUntil, "moderation_action");
      } catch (error) {
        console.error("[moderation] suspend failed:", error);
        return { ok: false, status: 500, error: "Failed to suspend the account." };
      }
      await revokeRealtimeFor(report.target_author_id!);
      status = "actioned";
      auditAction = "suspend_user";
      newState = { suspended_until: subjectUntil };
      subjectNotice = {
        title: "Your account has been suspended",
        body: `Suspended until ${until.toISOString().slice(0, 10)} for: ${reason}. You can appeal this decision.`,
      };
      break;
    }

    case "ban_user": {
      try {
        await setUserBlocked(report.target_author_id!, true, "admin_ban");
      } catch (error) {
        console.error("[moderation] ban failed:", error);
        return { ok: false, status: 500, error: "Failed to ban the account." };
      }
      await revokeRealtimeFor(report.target_author_id!);
      status = "actioned";
      auditAction = "ban_user";
      newState = { is_blocked: true };
      subjectNotice = {
        title: "Your account has been banned",
        body: `Banned for: ${reason}. You can appeal this decision.`,
      };
      break;
    }
  }

  const { error: updateError } = await (db as unknown as SupabaseClient)
    .from("interaction_reports")
    .update({
      status,
      resolution_note: note,
      resolved_at: new Date().toISOString(),
      resolved_by: moderatorId,
    })
    .eq("id", report.id);

  if (updateError) {
    console.error("[moderation] report update failed:", updateError);
    return { ok: false, status: 500, error: "Failed to resolve the report." };
  }

  await recordModerationAction(db, {
    moderatorId,
    moderatorSid,
    action: auditAction,
    targetType: report.target_type,
    targetId: report.target_id,
    reportId: report.id,
    subjectUserId: report.target_author_id,
    previousState,
    newState,
    reason,
  });

  // A suspended or banned member cannot sign in to read the in-app notice, so
  // the restriction is also delivered as an email carrying a signed appeal
  // link. Its failure never fails the moderation action.
  if (
    report.target_author_id &&
    (action === "suspend_user" || action === "ban_user")
  ) {
    await sendRestrictionAppealEmail(
      db,
      report,
      action === "ban_user"
        ? `Your account was banned for: ${reason}.`
        : `Your account was suspended until ${subjectUntil?.slice(0, 10) ?? "the suspension ends"} for: ${reason}.`,
    ).catch((error) => {
      logEvent("warn", {
        event: "moderation.appeal_email.failed",
        reportId: report.id,
        error,
      });
    });
  }

  // ── The reporter: reviewed, never told who was actioned ──
  await createNotification(db, {
    userId: report.reporter_id,
    actorId: null,
    communityId: report.community_id,
    type: "report_reviewed",
    entityType,
    entityId,
    title: status === "dismissed" ? "Your report was reviewed" : "Thanks for your report",
    body:
      status === "dismissed"
        ? `We reviewed the ${targetLabel} you reported and did not find a violation.`
        : status === "removed"
          ? `We reviewed the ${targetLabel} you reported and took action.`
          : `We reviewed the ${targetLabel} you reported and acted on the account.`,
    href: report.community_id
      ? `/dashboard/communities/${report.community_id}`
      : "/dashboard/notifications",
  });

  // ── The subject: what happened and where to appeal ──
  if (subjectNotice && report.target_author_id) {
    await createNotification(db, {
      userId: report.target_author_id,
      actorId: null,
      communityId: report.community_id,
      type: "moderation_action",
      // Keyed by the report, not the target: the moderation notice must not
      // aggregate into an unrelated unread notification on the same thread or
      // community.
      entityType: "moderation",
      entityId: report.id,
      title: subjectNotice.title,
      body: subjectNotice.body,
      href: subjectHref(),
      metadata: { report_id: report.id, action },
    });
  }

  return { ok: true, status };
}

/**
 * Deliver the signed appeal link. Silent no-op when the deployment has no
 * public URL or the account has no email, so a moderation action is never
 * blocked by email configuration.
 */
async function sendRestrictionAppealEmail(
  db: ServiceClient,
  report: ModerationReport,
  decision: string,
): Promise<void> {
  if (!report.target_author_id) return;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return;

  const { data: user } = await db
    .from("users")
    .select("email, name")
    .eq("id", report.target_author_id)
    .maybeSingle();
  const email = (user as { email?: string | null } | null)?.email;
  if (!email) return;

  const [{ createAppealToken, APPEAL_TOKEN_TTL_DAYS }, { sendModerationAppealEmail }] =
    await Promise.all([import("./appeal-token"), import("@/lib/email")]);

  const token = await createAppealToken({
    reportId: report.id,
    userId: report.target_author_id,
  });
  const name = (user as { name?: string | null } | null)?.name?.trim() || "there";

  await sendModerationAppealEmail(
    email,
    name,
    `${appUrl.replace(/\/$/, "")}/appeals/${token}`,
    decision,
    APPEAL_TOKEN_TTL_DAYS,
  );
}

async function suspendUser(
  userId: string,
  until: string,
  reason: string,
): Promise<void> {
  const { createServiceClient } = await import("@/lib/supabase/service");
  const db = createServiceClient();
  const { error } = await (db as unknown as SupabaseClient).rpc("set_user_suspended", {
    p_user_id: userId,
    p_until: until,
    p_reason: reason,
  });
  if (error) throw new Error(`set_user_suspended failed: ${error.message}`);
}

async function revokeRealtimeFor(userId: string): Promise<void> {
  try {
    await revokeRealtimeSessions({ userId, all: true });
  } catch (error) {
    logEvent("warn", {
      event: "moderation.account_action.realtime_failed",
      userId,
      error,
    });
  }
}

// Imported lazily to keep this module importable from tests that stub the
// notification layer; the queue is server-only either way.
async function createNotification(
  db: ServiceClient,
  input: Parameters<typeof import("@/lib/notifications").createNotification>[1],
) {
  const { createNotification: notify } = await import("@/lib/notifications");
  await notify(db, input);
}
