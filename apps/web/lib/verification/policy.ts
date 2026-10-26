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

/** Unix ms when the member becomes eligible for the banner / write gate. */
export function verificationEligibleAt(
  createdAt: string | null | undefined,
  graceDays: number,
): number {
  const created = createdAt ? new Date(createdAt).getTime() : Number.NaN;
  if (!Number.isFinite(created)) return Date.now();
  return created + clampGraceDays(graceDays) * 24 * 60 * 60 * 1000;
}

/** Should the persistent read-only banner render? */
export function isVerificationBannerVisible(input: {
  status: string | null | undefined;
  createdAt: string | null | undefined;
  graceDays: number;
  now?: number;
}): boolean {
  if (input.status === "approved") return false;
  if (input.status === "unverified") {
    return (input.now ?? Date.now()) >= verificationEligibleAt(input.createdAt, input.graceDays);
  }
  return true;
}

/** Should writes be refused for this member right now? */
export function isVerificationRestricted(input: {
  status: string | null | undefined;
  createdAt: string | null | undefined;
  graceDays: number;
  now?: number;
}): boolean {
  if (input.status === "approved") return false;
  if (input.status === "unverified") {
    return (input.now ?? Date.now()) >= verificationEligibleAt(input.createdAt, input.graceDays);
  }
  return true;
}
