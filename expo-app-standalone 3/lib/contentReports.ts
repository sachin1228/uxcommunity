import type { ContentKind } from './communityContent';

/**
 * The content report flow's shared vocabulary — the mobile mirror of the web
 * app's `lib/communities/report-reasons.ts`, with the `POST` itself in
 * `contentReportsApi.ts`.
 *
 * The reason values are the persisted ids the `content_reports` check
 * constraint accepts; the labels are what the modal offers and what a removal
 * notice quotes back. Keep this list in step with the web module — the report
 * API validates against the same values.
 *
 * This module deliberately imports nothing from React Native (the API client
 * does), so the value contract runs in the plain-Node suite.
 */

export const REPORT_REASONS = [
  { value: 'spam', label: 'Spam or scam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate', label: 'Hate speech or discrimination' },
  { value: 'misinformation', label: 'False or misleading info' },
  { value: 'inappropriate', label: 'Inappropriate or violent content' },
  // Design work gets re-shared constantly, so borrowed work is its own reason.
  { value: 'intellectual_property', label: 'Stolen work or plagiarism' },
  { value: 'off_topic', label: 'Off-topic or low effort' },
  { value: 'other', label: 'Something else' },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]['value'];

/** The optional explanation the reporter can add — 1000 characters. */
export const REPORT_DETAILS_MAX_LENGTH = 1000;

/** The four kinds of content a member can report. */
export const REPORT_CONTENT_TYPES = ['thread', 'showcase', 'resource', 'event'] as const;

export type ReportableContentType = (typeof REPORT_CONTENT_TYPES)[number];

/** How each reported kind is named in copy. */
export const REPORT_CONTENT_LABELS: Record<ReportableContentType, string> = {
  thread: 'thread',
  showcase: 'showcase post',
  resource: 'resource',
  event: 'event',
};

/** The card kind (a tab key) to the report API's singular content type. */
export const REPORT_CONTENT_TYPE_BY_KIND: Record<ContentKind, ReportableContentType> = {
  threads: 'thread',
  showcase: 'showcase',
  resources: 'resource',
  events: 'event',
};

/** The label for a stored reason, falling back to the raw id for old rows. */
export function reportReasonLabel(reason: string): string {
  return REPORT_REASONS.find((item) => item.value === reason)?.label ?? reason;
}

/**
 * Whether an error from `reportContent` means "already reported" — the API's
 * 409. The menu treats that as acknowledged, exactly like the web modal.
 */
export function isAlreadyReported(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { status?: unknown }).status === 409
  );
}
