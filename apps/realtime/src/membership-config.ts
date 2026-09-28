/**
 * Membership-check configuration resolution.
 *
 * WHY THIS EXISTS (production-readiness audit, M-8 — fail-open)
 *   `Room.checkMembership` used to return `true` when `API_URL` was unset, so a
 *   single missing environment variable silently disabled room authorization:
 *   any authenticated member (JWT still required) could open a socket into any
 *   community. Missing authorization configuration is a server misconfiguration
 *   and must fail CLOSED, not grant access.
 *
 * Kept dependency-free so the decision can be unit-tested without a Worker.
 */

export interface MembershipConfig {
  /** True only when an internal API URL is actually configured. */
  configured: boolean;
  /** Trimmed base URL (no trailing slash), or null when unconfigured. */
  apiUrl: string | null;
}

/** True only for a non-empty string that parses as an http(s) URL. */
function usableApiUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return trimmed;
  } catch {
    return null;
  }
}

export function resolveMembershipConfig(env: { API_URL?: unknown }): MembershipConfig {
  const apiUrl = usableApiUrl(env.API_URL);
  return { configured: apiUrl !== null, apiUrl };
}
