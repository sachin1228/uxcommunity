/**
 * Session lifetime policy.
 *
 * Member sessions are long-lived and slide forward while they are used, so the
 * mobile app never signs a member out on a timer. Admin sessions stay short.
 * Pure so the edge runtime and the unit suite share one source of truth.
 */

export const USER_SESSION_EXPIRY_SECONDS = 60 * 60 * 24 * 365;
export const ADMIN_SESSION_EXPIRY_SECONDS = 60 * 60 * 24 * 7;

/** Renew an authenticated session when it enters its final month. */
export const SESSION_RENEWAL_WINDOW_SECONDS = 60 * 60 * 24 * 30;

export function sessionExpirySeconds(role: "user" | "admin"): number {
  return role === "admin" ? ADMIN_SESSION_EXPIRY_SECONDS : USER_SESSION_EXPIRY_SECONDS;
}

export function shouldRenewSession(
  expiresAtSeconds: number | undefined,
  nowSeconds: number,
): boolean {
  return (
    typeof expiresAtSeconds === "number" &&
    expiresAtSeconds - nowSeconds <= SESSION_RENEWAL_WINDOW_SECONDS
  );
}
