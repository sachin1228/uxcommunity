import "server-only";

import { createServiceClient } from "@/lib/supabase/service";

/**
 * Server-side session registry operations.
 *
 * The JWT is only a pointer: `auth_sessions.id` is the `sid` claim, and
 * `users.session_version` is the generation it was issued under. Every
 * revocation decision is persisted here before the cookie is cleared.
 *
 * All functions are service-role only. They are deliberately small wrappers so
 * route handlers cannot forget the version bump or accidentally update only the
 * cookie.
 */

export const SESSION_EXPIRY_SECONDS = 60 * 60 * 24 * 7;

export class AccountUnavailableError extends Error {
  constructor() {
    super("account_unavailable");
    this.name = "AccountUnavailableError";
  }
}

/** The stored password changed between the route's compare and the update. */
export class PasswordChangedError extends Error {
  constructor() {
    super("password_changed");
    this.name = "PasswordChangedError";
  }
}

export interface IssuedSession {
  sessionId: string;
  sessionVersion: number;
  expiresAt: string;
}

export type SessionRole = "user" | "admin";

function expiryFromNow(): string {
  return new Date(Date.now() + SESSION_EXPIRY_SECONDS * 1000).toISOString();
}

/**
 * Create the registry row a new JWT points at.
 *
 * `create_auth_session` reads `users.session_version` and inserts the row in one
 * statement, so a reset/suspension that commits between the login read and the
 * insert cannot produce a token with a stale version.
 */
export async function createAuthSession(input: {
  userId?: string | null;
  role: SessionRole;
  userAgent?: string | null;
  expiresAt?: string;
}): Promise<IssuedSession> {
  const db = createServiceClient();
  const expiresAt = input.expiresAt ?? expiryFromNow();

  const { data, error } = await db.rpc("create_auth_session", {
    p_user_id: input.role === "user" ? (input.userId ?? null) : null,
    p_role: input.role,
    p_expires_at: expiresAt,
    p_user_agent: input.userAgent?.slice(0, 512) ?? null,
  });

  if (error) {
    if (error.message.includes("account_unavailable")) {
      throw new AccountUnavailableError();
    }
    throw new Error(`create_auth_session failed: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.session_id) {
    throw new Error("create_auth_session returned no session");
  }

  return {
    sessionId: row.session_id,
    sessionVersion: row.session_version,
    expiresAt,
  };
}

/** Revoke exactly one registry row. Missing/already-revoked rows are a no-op. */
export async function revokeAuthSession(
  sessionId: string,
  reason: string,
): Promise<boolean> {
  if (!sessionId) return true;
  const db = createServiceClient();
  const { error } = await db
    .from("auth_sessions")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_reason: reason,
    })
    .eq("id", sessionId)
    .is("revoked_at", null);

  if (error) {
    console.error("[session-registry] revoke failed:", error);
    return false;
  }
  return true;
}

/**
 * Logout-all / reset / suspension.
 *
 * Bumps the generation and revokes every active row. Returns the new version,
 * or null when the account no longer exists.
 */
export async function revokeAllUserSessions(
  userId: string,
  reason: string,
): Promise<number | null> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("revoke_all_user_sessions", {
    p_user_id: userId,
    p_reason: reason,
  });

  if (error) {
    throw new Error(`revoke_all_user_sessions failed: ${error.message}`);
  }

  return typeof data === "number" ? data : null;
}

/** Password change: revoke every device except the current one. */
export async function revokeOtherUserSessions(
  userId: string,
  keepSessionId: string | null,
  reason: string,
): Promise<number> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("revoke_other_user_sessions", {
    p_user_id: userId,
    p_keep_session_id: keepSessionId,
    p_reason: reason,
  });

  if (error) {
    throw new Error(`revoke_other_user_sessions failed: ${error.message}`);
  }
  return typeof data === "number" ? data : 0;
}

/** Update the password and revoke every other device in one transaction. */
export async function changeUserPassword(
  userId: string,
  passwordHash: string,
  keepSessionId: string | null,
  expectedHash: string | null = null,
): Promise<number> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("change_user_password", {
    p_user_id: userId,
    p_password_hash: passwordHash,
    p_keep_session_id: keepSessionId,
    p_expected_hash: expectedHash,
  });

  if (error) {
    if (error.message.includes("account_unavailable")) {
      throw new AccountUnavailableError();
    }
    if (error.message.includes("password_changed")) {
      throw new PasswordChangedError();
    }
    throw new Error(`change_user_password failed: ${error.message}`);
  }
  return typeof data === "number" ? data : 0;
}

/** Block or unblock an account, bump the version and revoke every session. */
export async function setUserBlocked(
  userId: string,
  blocked: boolean,
  reason: string,
): Promise<{ id: string; is_blocked: boolean; session_version: number }> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("set_user_blocked", {
    p_user_id: userId,
    p_blocked: blocked,
    p_reason: reason,
  });

  if (error) {
    if (error.message.includes("account_unavailable")) {
      throw new AccountUnavailableError();
    }
    throw new Error(`set_user_blocked failed: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new AccountUnavailableError();
  return row;
}

/** Atomic password reset: claim token, update hash, bump version, revoke all. */
export async function completePasswordReset(
  token: string,
  passwordHash: string,
): Promise<{ status: "ok" | "invalid" | "used" | "expired" | "missing_user"; userId: string | null }> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("complete_password_reset", {
    p_token: token,
    p_password_hash: passwordHash,
  });

  if (error) {
    throw new Error(`complete_password_reset failed: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  return {
    status: (row?.status ?? "invalid") as
      | "ok"
      | "invalid"
      | "used"
      | "expired"
      | "missing_user",
    userId: row?.user_id ?? null,
  };
}

/** Revoke every environment-admin session (admin logout-all). */
export async function revokeAllAdminSessions(reason: string): Promise<number> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("revoke_all_admin_sessions", {
    p_reason: reason,
  });

  if (error) {
    throw new Error(`revoke_all_admin_sessions failed: ${error.message}`);
  }
  return typeof data === "number" ? data : 0;
}
