/**
 * Auth API helpers — thin wrappers around the web app's auth endpoints.
 */

import { apiFetch, clearSession } from './api';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'user' | 'admin';
  profileComplete: boolean;
  avatar_url: string | null;
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
  const { data } = await apiFetch<LoginResult>('/api/auth/login', {
    method: 'POST',
    body: { email, password },
  });

  // After login the session cookie is already persisted by apiFetch. Newer
  // servers return the trusted user row with it; the extra /me is only the
  // fallback for an older deployment (and for the env admin account, whose
  // session has no profile row of its own).
  const isAdmin = data.redirect === '/admin';
  const me = data.user ?? (await getMe());

  return { user: me, isAdmin };
}

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

export async function logout(): Promise<void> {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
  } finally {
    await clearSession();
  }
}

// ---------------------------------------------------------------------------
// getMe
// ---------------------------------------------------------------------------

export async function getMe(): Promise<User | null> {
  const { data } = await apiFetch<{ user: User | null }>('/api/auth/me');
  return data.user;
}
