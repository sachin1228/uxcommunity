/**
 * Auth API helpers — thin wrappers around the web app's auth endpoints.
 */

import { apiFetch } from './api';
import { loginWith } from './loginFlow';
export type VerificationStatus = 'unverified' | 'pending' | 'approved' | 'rejected';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  profileComplete: boolean;
  avatar_url: string | null;
  /** Read-only accounts are `unverified`, `pending` or `rejected`. */
  verificationStatus?: VerificationStatus;
  verificationReapplyAt?: string | null;
  verificationRejectionReason?: string | null;
  emailVerifiedAt?: string | null;
}

export interface LoginResult {
  success: true;
  name?: string;
  redirect?: string; // "/admin" for admin users
  /** Present on current servers; older ones only returned the redirect. */
  user?: User;
}

// ---------------------------------------------------------------------------
// login
// ---------------------------------------------------------------------------

export async function login(
  email: string,
  password: string
): Promise<{ user: User | null; isAdmin: boolean }> {
  // After login the session cookie is already persisted by apiFetch. A
  // current server returns the trusted user row with the response; the extra
  // /me is only the fallback for an older deployment (and for the env admin
  // account, whose session has no profile row of its own).
  return loginWith(
    (path, options) => apiFetch<LoginResult>(path, options),
    getMe,
    email,
    password
  );
}

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

export async function logout(): Promise<void> {
  // Local session teardown belongs to AuthContext's bounded logout sequence.
  // Keeping a clearSession() in this finally would let a late logout response
  // erase the cookie of a newer login that superseded it.
  await apiFetch('/api/auth/logout', { method: 'POST' });
}

// ---------------------------------------------------------------------------
// getMe
// ---------------------------------------------------------------------------

export async function getMe(): Promise<User | null> {
  const { data } = await apiFetch<{ user: User | null }>('/api/auth/me');
  return data.user;
}
