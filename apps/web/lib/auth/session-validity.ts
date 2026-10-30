/**
 * The one session-validity decision.
 *
 * Both the HTTP session read (`lib/auth/session.ts`) and the internal realtime
 * validation route use this function, so a socket and a page cannot disagree
 * about whether a token is still live. Kept dependency-free so the full
 * revocation matrix (logout, version bump, reset, suspension, expiry, admin
 * epoch) is unit-tested without a database.
 */

export interface SessionUserRow {
  id: string;
  is_blocked: boolean;
  /** ISO timestamp; a future value means a live temporary suspension. */
  suspended_until?: string | null;
  session_version: number;
}

export interface SessionRegistryRow {
  id: string;
  user_id: string | null;
  role: string;
  session_version: number;
  revoked_at: string | null;
  expires_at: string;
  users: SessionUserRow | SessionUserRow[] | null;
}

export interface SessionClaims {
  userId?: string;
  role: "user" | "admin";
  sv?: number;
  adm?: string;
}

export interface SessionValidityOptions {
  now?: number;
  adminEpoch: string | null;
  /** Account erasure only: a blocked member may still delete their account. */
  allowBlocked?: boolean;
}

export type SessionValidity =
  | { active: true; user: SessionUserRow | null }
  | { active: false };

export function isSuspendedAccount(
  suspendedUntil: string | null | undefined,
  now: number,
): boolean {
  if (!suspendedUntil) return false;
  const until = Date.parse(suspendedUntil);
  return Number.isFinite(until) && until > now;
}

export function embeddedSessionUser(
  row: SessionRegistryRow,
): SessionUserRow | null {
  return Array.isArray(row.users) ? (row.users[0] ?? null) : row.users;
}

/**
 * Is a signature-valid token backed by a live registry row and matching account
 * generation?
 *
 * Checks, in order: row exists, unrevoked, unexpired, role agrees, subject
 * agrees, registry version agrees, account still exists / is not blocked,
 * account version agrees. Admins additionally match the current
 * ADMIN_PASSWORD+SESSION_SECRET epoch and must not have a user subject.
 *
 * Fails closed on malformed timestamps.
 */
export function evaluateSession(
  row: SessionRegistryRow | null,
  claims: SessionClaims,
  options: SessionValidityOptions,
): SessionValidity {
  if (!row) return { active: false };

  const now = options.now ?? Date.now();
  if (row.revoked_at) return { active: false };

  const expiresAt = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    return { active: false };
  }

  if (claims.role === "admin") {
    if (row.role !== "admin" || row.user_id !== null) {
      return { active: false };
    }
    if (!options.adminEpoch || claims.adm !== options.adminEpoch) {
      return { active: false };
    }
    return { active: true, user: null };
  }

  if (row.role !== "user" || !row.user_id) return { active: false };
  if (row.user_id !== claims.userId) return { active: false };
  if (row.session_version !== claims.sv) return { active: false };

  const user = embeddedSessionUser(row);
  if (!user) return { active: false };
  if (!options.allowBlocked && user.is_blocked) return { active: false };
  if (!options.allowBlocked && isSuspendedAccount(user.suspended_until, now)) {
    return { active: false };
  }
  if (user.session_version !== claims.sv) return { active: false };

  return { active: true, user };
}
