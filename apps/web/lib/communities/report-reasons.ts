/**
 * The report reasons offered by the report modal, and the content kinds a
 * report can point at. Kept out of the view so the modal (client), the report
 * API (server validation) and the admin dashboard (rendering a stored reason)
 * all read the same list.
 *
 * `value` is the persisted id (the `content_reports.reason` check constraint
 * mirrors these exactly); `label` is what the user picks and what removal
 * notices quote back ("Removed for: Spam or scam").
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

export const REPORT_REASON_VALUES: ReadonlySet<string> = new Set(
  REPORT_REASONS.map((reason) => reason.value),
);

/** The optional explanation the reporter can add — 1000 characters. */
export const REPORT_DETAILS_MAX_LENGTH = 1000;

/** The four kinds of content a member can report. */
export const REPORT_CONTENT_TYPES = ["thread", "showcase", "resource", "event"] as const;

export type ReportableContentType = (typeof REPORT_CONTENT_TYPES)[number];

export const REPORT_CONTENT_TYPE_VALUES: ReadonlySet<string> = new Set(REPORT_CONTENT_TYPES);

/** How each reported kind is named in copy ("your thread", "this event"). */
export const REPORT_CONTENT_LABELS: Record<ReportableContentType, string> = {
  thread: "thread",
  showcase: "showcase post",
  resource: "resource",
  event: "event",
};

/** The label for a stored reason, falling back to the raw id for old rows. */
export function reportReasonLabel(reason: string): string {
  return REPORT_REASONS.find((item) => item.value === reason)?.label ?? reason;
}
