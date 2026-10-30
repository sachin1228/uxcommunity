/**
 * Appeal eligibility and copy shared by the member appeal form, its API and
 * the admin review surface.
 *
 * The rules are deliberately narrow:
 *   • only the account a moderation action was taken against may appeal;
 *   • only a report that ended in a removal or an account action can be
 *     appealed (a dismissed report affected nobody);
 *   • one appeal per report, ever (the database enforces it too), plus a small
 *     daily cap so a member cannot flood the queue with appeals on unrelated
 *     reports.
 */

export const APPEAL_MESSAGE_MIN_LENGTH = 20;
export const APPEAL_MESSAGE_MAX_LENGTH = 2000;
/** Appeals one member may file in a rolling 24 hours. */
export const APPEAL_DAILY_LIMIT = 3;

export const APPEAL_STATUSES = ["pending", "granted", "denied"] as const;
export type AppealStatus = (typeof APPEAL_STATUSES)[number];

export const APPEAL_STATUS_LABELS: Record<AppealStatus, string> = {
  pending: "Awaiting review",
  granted: "Granted",
  denied: "Denied",
};

export type AppealBlockedReason =
  | "not_affected_user"
  | "not_actioned"
  | "message_too_short"
  | "message_too_long";

export interface AppealEligibilityInput {
  status: string;
  targetAuthorId: string | null;
}

export type AppealEligibility =
  | { allowed: true }
  | { allowed: false; reason: AppealBlockedReason };

/** Can this member appeal this report's outcome? */
export function canAppealReport(
  report: AppealEligibilityInput,
  userId: string,
): AppealEligibility {
  if (!report.targetAuthorId || report.targetAuthorId !== userId) {
    return { allowed: false, reason: "not_affected_user" };
  }
  if (report.status !== "removed" && report.status !== "actioned") {
    return { allowed: false, reason: "not_actioned" };
  }
  return { allowed: true };
}

/** Validate the appeal text and combine it with the ownership decision. */
export function validateAppeal(
  report: AppealEligibilityInput,
  userId: string,
  message: string,
): AppealEligibility {
  const eligibility = canAppealReport(report, userId);
  if (!eligibility.allowed) return eligibility;

  const trimmed = message.trim();
  if (trimmed.length < APPEAL_MESSAGE_MIN_LENGTH) {
    return { allowed: false, reason: "message_too_short" };
  }
  if (trimmed.length > APPEAL_MESSAGE_MAX_LENGTH) {
    return { allowed: false, reason: "message_too_long" };
  }
  return { allowed: true };
}

/** The message the member sees for a blocked submission. */
export function appealBlockedMessage(reason: AppealBlockedReason): string {
  switch (reason) {
    case "not_affected_user":
      return "Only the account a moderation action was taken against can appeal it.";
    case "not_actioned":
      return "This report did not end in a moderation action, so there is nothing to appeal.";
    case "message_too_short":
      return `Explain why the decision should be reviewed — at least ${APPEAL_MESSAGE_MIN_LENGTH} characters.`;
    case "message_too_long":
      return `Keep your appeal under ${APPEAL_MESSAGE_MAX_LENGTH} characters.`;
  }
}
