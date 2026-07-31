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
}

export interface LoginResult {
  success: true;
  name?: string;
  redirect?: string; // "/admin" for admin users
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

  // After login the session cookie is already persisted by apiFetch.
  // Fetch the full user object.
  const isAdmin = data.redirect === '/admin';
  const me = await getMe();

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
