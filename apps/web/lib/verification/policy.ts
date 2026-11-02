/**
 * Pure verification grace-window rules.
 *
 * Kept free of Supabase/Next imports so the policy is unit-testable and the
 * server-only settings reader can wrap it.
 */

export const DEFAULT_VERIFICATION_GRACE_DAYS = 0;
export const MAX_VERIFICATION_GRACE_DAYS = 30;

export function clampGraceDays(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_VERIFICATION_GRACE_DAYS;
  }
  return Math.min(
    MAX_VERIFICATION_GRACE_DAYS,
    Math.max(0, Math.floor(value)),
  );
}

/** Unix ms when the grace window closes and the banner / write gate begins. */
export function verificationEligibleAt(
  createdAt: string | null | undefined,
  graceDays: number,
  now = Date.now(),
): number {
  const created = createdAt ? new Date(createdAt).getTime() : Number.NaN;
  if (!Number.isFinite(created)) return now;
  return created + clampGraceDays(graceDays) * 24 * 60 * 60 * 1000;
}

/**
 * Should the persistent read-only banner render?
 *
 * The banner follows the write gate: hidden during the new-account grace
 * window, shown once the window closes until an admin approves the account.
 */
export function isVerificationBannerVisible(input: {
  status: string | null | undefined;
  createdAt: string | null | undefined;
  graceDays: number;
  now?: number;
}): boolean {
  return Boolean(input.status) && isVerificationRestricted(input);
}

/**
 * Should writes be refused for this member right now?
 *
 * Policy A still requires approval, but the admin-set grace window runs from
 * signup: a non-approved account may write until `created_at + graceDays`.
 * An unknown status, a zero-day window, or an unreadable signup date applies
 * the gate at once.
 */
export function isVerificationRestricted(input: {
  status: string | null | undefined;
  createdAt: string | null | undefined;
  graceDays: number;
  now?: number;
}): boolean {
  if (input.status === "approved") return false;
  if (!input.status) return true;
  const now = input.now ?? Date.now();
  return now >= verificationEligibleAt(input.createdAt, input.graceDays, now);
}
