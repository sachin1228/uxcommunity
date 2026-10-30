import type { ContentKind } from './communityContent';

/**
 * The content report flow's shared vocabulary — the mobile mirror of the web
 * app's `lib/communities/report-reasons.ts`, with the `POST` itself in
 * `contentReportsApi.ts`.
 *
 * The reason values are the persisted ids the `content_reports` and
 * `interaction_reports` check constraints accept; the labels are what the modal
 * offers and what a removal notice quotes back. Posts and interactions share
 * the generic list; communities and job listings have their own — the server
 * validates the same per-target subsets, so a client cannot post a reason it
 * was not offered.
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

export const COMMUNITY_REPORT_REASONS = [
  { value: 'inappropriate', label: 'Inappropriate community content' },
  { value: 'harassment', label: 'Harassment or hate' },
  { value: 'spam', label: 'Spam or scams' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'illegal', label: 'Illegal or harmful activity' },
  { value: 'misinformation', label: 'Misleading community information' },
  { value: 'other', label: 'Other' },
] as const;

export const JOB_REPORT_REASONS = [
  { value: 'misinformation', label: 'Fake or misleading job' },
  { value: 'scam', label: 'Scam or fraudulent recruitment' },
  { value: 'spam', label: 'Spam' },
  { value: 'discriminatory', label: 'Discriminatory requirements' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'payment_request', label: 'Suspicious payment requests' },
  { value: 'impersonation', label: 'Impersonation of a company' },
  { value: 'expired', label: 'Expired or misleading opportunity' },
  { value: 'other', label: 'Other' },
] as const;

/** The optional explanation the reporter can add — 1000 characters. */
export const REPORT_DETAILS_MAX_LENGTH = 1000;

/** The four kinds of content a member can report. */
export const REPORT_CONTENT_TYPES = ['thread', 'showcase', 'resource', 'event'] as const;

export type ReportableContentType = (typeof REPORT_CONTENT_TYPES)[number];

/** Comments, chat messages, profiles, communities and job listings. */
export const INTERACTION_REPORT_TYPES = [
  'thread_comment',
  'showcase_comment',
  'resource_comment',
  'event_comment',
  'community_message',
  'profile',
  'community',
  'job',
] as const;

export type InteractionReportType = (typeof INTERACTION_REPORT_TYPES)[number];

export type ReportType = ReportableContentType | InteractionReportType;

export function isInteractionReportType(value: ReportType): value is InteractionReportType {
  return (INTERACTION_REPORT_TYPES as readonly string[]).includes(value);
}

export const CONTENT_REPORT_ENDPOINT = '/api/content-reports';
export const INTERACTION_REPORT_ENDPOINT = '/api/interaction-reports';

/** Posts go to the removal queue; everything else to the interaction queue. */
export function reportEndpointFor(contentType: ReportType): string {
  return isInteractionReportType(contentType)
    ? INTERACTION_REPORT_ENDPOINT
    : CONTENT_REPORT_ENDPOINT;
}

/** The reason list a target may be reported with. */
export function reportReasonsFor(
  contentType: ReportType
): ReadonlyArray<{ value: string; label: string }> {
  switch (contentType) {
    case 'community':
      return COMMUNITY_REPORT_REASONS;
    case 'job':
      return JOB_REPORT_REASONS;
    default:
      return REPORT_REASONS;
  }
}

/** Does this target accept this reason? Mirrors the server's validation. */
export function isReportReasonValidFor(contentType: ReportType, reason: string): boolean {
  return reportReasonsFor(contentType).some((option) => option.value === reason);
}

/** How each reported kind is named in copy. */
export const REPORT_CONTENT_LABELS: Record<ReportType, string> = {
  thread: 'thread',
  showcase: 'showcase post',
  resource: 'resource',
  event: 'event',
  thread_comment: 'comment',
  showcase_comment: 'comment',
  resource_comment: 'comment',
  event_comment: 'comment',
  community_message: 'message',
  profile: 'profile',
  community: 'community',
  job: 'job listing',
};

/** The comment surface's kind to the interaction report API's type. */
export const REPORT_COMMENT_TYPE_BY_KIND: Record<ContentKind, InteractionReportType> = {
  threads: 'thread_comment',
  showcase: 'showcase_comment',
  resources: 'resource_comment',
  events: 'event_comment',
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
  for (const option of [
    ...REPORT_REASONS,
    ...COMMUNITY_REPORT_REASONS,
    ...JOB_REPORT_REASONS,
  ]) {
    if (option.value === reason) return option.label;
  }
  return reason;
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
