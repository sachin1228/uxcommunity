/**
 * The report reasons offered by the report modal, and the content kinds a
 * report can point at. Kept out of the view so the modal (client), the report
 * API (server validation) and the admin dashboard (rendering a stored reason)
 * all read the same list.
 *
 * `value` is the persisted id (the `content_reports.reason` and
 * `interaction_reports.reason` check constraints mirror the union of every
 * list); `label` is what the user picks and what removal notices quote back
 * ("Removed for: Spam or scam").
 *
 * A target is only offered — and only accepts — the reasons in its own list:
 * posts and interactions share the generic list, while communities and job
 * listings have the specific options members need to describe those reports.
 */

export const REPORT_REASONS = [
  { value: "spam", label: "Spam or scam" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "hate", label: "Hate speech or discrimination" },
  { value: "misinformation", label: "False or misleading info" },
  { value: "inappropriate", label: "Inappropriate or violent content" },
  // Design work gets re-shared constantly, so borrowed work is its own reason.
  { value: "intellectual_property", label: "Stolen work or plagiarism" },
  { value: "off_topic", label: "Off-topic or low effort" },
  { value: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["value"];

/** The generic reasons accepted by posts and interaction reports. */
export const REPORT_REASON_VALUES: ReadonlySet<string> = new Set(
  REPORT_REASONS.map((reason) => reason.value),
);

/** The optional explanation the reporter can add — 1000 characters. */
export const REPORT_DETAILS_MAX_LENGTH = 1000;

/** The four kinds of POST that use the content_reports removal queue. */
export const REPORT_CONTENT_TYPES = ["thread", "showcase", "resource", "event"] as const;

export type ReportableContentType = (typeof REPORT_CONTENT_TYPES)[number];

export const REPORT_CONTENT_TYPE_VALUES: ReadonlySet<string> = new Set(REPORT_CONTENT_TYPES);

/**
 * Communities use the generic ids where they fit and add the ones only a
 * whole-community report needs. Order is the order the modal shows.
 */
export const COMMUNITY_REPORT_REASONS = [
  { value: "inappropriate", label: "Inappropriate community content" },
  { value: "harassment", label: "Harassment or hate" },
  { value: "spam", label: "Spam or scams" },
  { value: "impersonation", label: "Impersonation" },
  { value: "illegal", label: "Illegal or harmful activity" },
  { value: "misinformation", label: "Misleading community information" },
  { value: "other", label: "Other" },
] as const;

/** Job listings carry the recruitment-specific reasons. */
export const JOB_REPORT_REASONS = [
  { value: "misinformation", label: "Fake or misleading job" },
  { value: "scam", label: "Scam or fraudulent recruitment" },
  { value: "spam", label: "Spam" },
  { value: "discriminatory", label: "Discriminatory requirements" },
  { value: "inappropriate", label: "Inappropriate content" },
  { value: "payment_request", label: "Suspicious payment requests" },
  { value: "impersonation", label: "Impersonation of a company" },
  { value: "expired", label: "Expired or misleading opportunity" },
  { value: "other", label: "Other" },
] as const;

/** Comments, chat messages and profiles use the interaction report queue. */
export const INTERACTION_REPORT_TYPES = [
  "thread_comment",
  "showcase_comment",
  "resource_comment",
  "event_comment",
  "community_message",
  "profile",
  "community",
  "job",
] as const;

export type InteractionReportType = (typeof INTERACTION_REPORT_TYPES)[number];

export const INTERACTION_REPORT_TYPE_VALUES: ReadonlySet<string> = new Set(
  INTERACTION_REPORT_TYPES,
);

/** Every reportable kind, for the shared report modal's copy. */
export type ReportType = ReportableContentType | InteractionReportType;

export function isInteractionReportType(value: string): value is InteractionReportType {
  return INTERACTION_REPORT_TYPE_VALUES.has(value);
}

export const CONTENT_REPORT_ENDPOINT = "/api/content-reports";
export const INTERACTION_REPORT_ENDPOINT = "/api/interaction-reports";

/** Posts go to the removal queue; comments/messages/profiles/communities/jobs to the other. */
export function reportEndpointFor(contentType: ReportType): string {
  return isInteractionReportType(contentType)
    ? INTERACTION_REPORT_ENDPOINT
    : CONTENT_REPORT_ENDPOINT;
}

/** The reason list a target may be reported with. */
export function reportReasonsFor(
  contentType: ReportType,
): ReadonlyArray<{ value: string; label: string }> {
  switch (contentType) {
    case "community":
      return COMMUNITY_REPORT_REASONS;
    case "job":
      return JOB_REPORT_REASONS;
    default:
      return REPORT_REASONS;
  }
}

/** Does this target accept this reason? Mirrors the server's validation. */
export function isReportReasonValidFor(contentType: ReportType, reason: string): boolean {
  return reportReasonsFor(contentType).some((option) => option.value === reason);
}

/** The full persisted vocabulary — every list the database accepts. */
export const ALL_REPORT_REASON_VALUES: ReadonlySet<string> = new Set([
  ...REPORT_REASON_VALUES,
  ...COMMUNITY_REPORT_REASONS.map((reason) => reason.value),
  ...JOB_REPORT_REASONS.map((reason) => reason.value),
]);

/** Deduplicated options for the admin reason filter. */
export const ALL_REPORT_REASONS: ReadonlyArray<{ value: string; label: string }> = (() => {
  const seen = new Set<string>();
  const options: Array<{ value: string; label: string }> = [];
  for (const option of [...REPORT_REASONS, ...COMMUNITY_REPORT_REASONS, ...JOB_REPORT_REASONS]) {
    if (seen.has(option.value)) continue;
    seen.add(option.value);
    options.push({ value: option.value, label: option.label });
  }
  return options;
})();

/** How each reported kind is named in copy ("your thread", "this event"). */
export const REPORT_CONTENT_LABELS: Record<ReportType, string> = {
  thread: "thread",
  showcase: "showcase post",
  resource: "resource",
  event: "event",
  thread_comment: "comment",
  showcase_comment: "comment",
  resource_comment: "comment",
  event_comment: "comment",
  community_message: "message",
  profile: "profile",
  community: "community",
  job: "job listing",
};

/** The label for a stored reason, falling back to the raw id for old rows. */
export function reportReasonLabel(reason: string): string {
  for (const option of [
    ...REPORT_REASONS,
    ...COMMUNITY_REPORT_REASONS,
    ...JOB_REPORT_REASONS,
  ]) {
    if (option.value === reason) return option.label;
  }
  return reason;
}
