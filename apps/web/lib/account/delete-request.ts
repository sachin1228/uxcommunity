/**
 * Validation for a member-initiated account deletion.
 *
 * Kept pure so the two confirmation rules (current password + the literal
 * word DELETE) can be unit-tested without a request or a database. The route
 * still does the password comparison; this only decides whether the request
 * is well-formed enough to compare against.
 */

export type DeleteAccountRequestResult =
  | { ok: true; password: string }
  | { ok: false; status: 400 | 422; error: string };

export function parseDeleteAccountRequest(body: unknown): DeleteAccountRequestResult {
  if (!body || typeof body !== "object") {
    return { ok: false, status: 400, error: "Invalid request body." };
  }

  const { password, confirmation } = body as {
    password?: unknown;
    confirmation?: unknown;
  };

  if (typeof password !== "string" || password.length === 0) {
    return { ok: false, status: 422, error: "Enter your password to continue." };
  }

  if (confirmation !== "DELETE") {
    return {
      ok: false,
      status: 422,
      error: "Type DELETE to confirm you want to delete your account.",
    };
  }

  return { ok: true, password };
}
