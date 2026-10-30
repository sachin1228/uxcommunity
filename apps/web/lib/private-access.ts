/**
 * Access rules for private files — pure functions, unit-tested.
 *
 * Keeping the decisions here (instead of inside route handlers) lets the IDOR
 * matrix be exercised without a database or a running server: an unrelated
 * member changing an application id, an employer opening another employer's
 * applicant, or a member guessing another member's verification request all
 * resolve to `false` before any object key is read or any URL is signed.
 */

export interface ApplicationResumeAccess {
  viewerId: string;
  applicantId: string;
  posterId: string | null;
  isAdmin?: boolean;
}

/**
 * An application's resume is readable by the applicant who submitted it and
 * the member who posted the job. Admins are not granted resume access: their
 * moderation tools never need the document itself, and least privilege keeps
 * the PII surface small.
 */
export function canViewApplicationResume(input: ApplicationResumeAccess): boolean {
  if (input.viewerId === input.applicantId) return true;
  if (input.posterId && input.viewerId === input.posterId) return true;
  return false;
}

export interface VerificationSampleAccess {
  viewerId: string;
  ownerId: string;
  isAdmin?: boolean;
}

/** Work samples are visible to their owner and to an explicitly admin session. */
export function canViewVerificationSample(input: VerificationSampleAccess): boolean {
  return input.viewerId === input.ownerId || input.isAdmin === true;
}

export interface SavedResumeAccess {
  viewerId: string;
  ownerId: string;
}

/** A saved resume is a member's own file, full stop. */
export function canViewSavedResume(input: SavedResumeAccess): boolean {
  return input.viewerId === input.ownerId;
}

export interface DmAssetAccess {
  viewerId: string;
  participants: readonly string[];
  isAdmin?: boolean;
}

/**
 * A DM image is readable by the two conversation participants. Admin access is
 * explicit because the report queue renders evidence outside the conversation.
 */
export function canViewDmAsset(input: DmAssetAccess): boolean {
  return input.isAdmin === true || input.participants.includes(input.viewerId);
}
