import type { InteractionReportType } from "@/lib/communities/report-reasons";

/**
 * Client-safe catalogue of moderator actions.
 *
 * The engine that performs these actions is server-only (`resolve-report.ts`);
 * this module holds only the labels, ordering and target rules that the admin
 * UI and its dialog need, so a client component never pulls the service-role
 * client into its bundle.
 */

export type ModerationActionId =
  | "dismiss"
  | "remove"
  | "hide_community"
  | "deactivate_job"
  | "warn_user"
  | "suspend_user"
  | "ban_user";

export const MODERATION_ACTION_LABELS: Record<ModerationActionId, string> = {
  dismiss: "Dismiss report",
  remove: "Remove content",
  hide_community: "Hide community",
  deactivate_job: "Deactivate job",
  warn_user: "Warn user",
  suspend_user: "Suspend user",
  ban_user: "Ban user",
};

/** Actions that change state and therefore ask for confirmation. */
export const DESTRUCTIVE_MODERATION_ACTIONS: ReadonlySet<ModerationActionId> = new Set([
  "remove",
  "hide_community",
  "deactivate_job",
  "suspend_user",
  "ban_user",
]);

export const SUSPENSION_DAY_OPTIONS = [1, 3, 7, 14, 30] as const;
export const MAX_SUSPENSION_DAYS = 30;

/** The actions the queue offers for a target type, in menu order. */
export function allowedModerationActions(
  targetType: InteractionReportType,
): ModerationActionId[] {
  const account: ModerationActionId[] = ["warn_user", "suspend_user", "ban_user"];
  const dismiss: ModerationActionId[] = ["dismiss"];

  switch (targetType) {
    case "community":
      return ["hide_community", ...account, ...dismiss];
    case "job":
      return ["deactivate_job", ...account, ...dismiss];
    case "profile":
      return [...account, ...dismiss];
    default:
      return ["remove", ...account, ...dismiss];
  }
}

/** Account actions need somebody to act on; master-data communities have nobody. */
export function actionNeedsSubject(action: ModerationActionId): boolean {
  return action === "warn_user" || action === "suspend_user" || action === "ban_user";
}

/** How an audit row's action reads in the history list. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  dismiss_report: "Dismissed the report",
  remove_content: "Removed the content",
  hide_community: "Hid the community",
  deactivate_job: "Deactivated the job",
  warn_user: "Warned the account",
  suspend_user: "Suspended the account",
  ban_user: "Banned the account",
  unban_user: "Unbanned the account",
  lift_suspension: "Lifted the suspension",
  grant_appeal: "Granted an appeal",
  deny_appeal: "Denied an appeal",
  delete_user: "Deleted the account",
  review_dm_report: "Reviewed the DM report",
  reopen_dm_report: "Reopened the DM report",
  restore_content: "Restored the content",
  reopen_report: "Reopened the report",
  toggle_community: "Changed community visibility",
  delete_community: "Deleted the community",
  toggle_job: "Changed job status",
  delete_job: "Deleted the job",
};
