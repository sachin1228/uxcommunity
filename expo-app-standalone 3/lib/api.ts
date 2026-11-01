import { validateMobileEnvironment } from "./environment";
/**
 * Base API client for the web app backend.
 *
 * Session management: the web backend issues an HttpOnly JWT cookie named
 * `uxcommunity_session`. React Native can read `Set-Cookie` response headers from
 * native fetch, so we capture the token value and replay it as a Cookie header
 * on every subsequent request.
 *
 * Configure EXPO_PUBLIC_API_URL in your .env / EAS secrets, e.g.:
 *   EXPO_PUBLIC_API_URL=https://app.example.com
 */

import { shouldApplySessionCookie } from './sessionLifecycle';
import {
  clearStoredSessionToken,
  readStoredSessionToken,
  writeStoredSessionToken,
} from './sessionStorage';

validateMobileEnvironment();

const SESSION_COOKIE_NAME = 'uxcommunity_session';

export const API_BASE_URL =
  (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/** Persist the uxcommunity_session cookie value extracted from a Set-Cookie header. */
async function saveSessionCookie(setCookieHeader: string): Promise<void> {
  // Format: uxcommunity_session=<value>; Path=/; HttpOnly; ...
  const match = setCookieHeader.match(
    new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`)
  );
  if (match?.[1]) {
    // Most responses do not rotate the cookie; skip the storage write when
    // the value is already the one in memory.
    if (sessionToken === match[1]) return;
    sessionToken = match[1];
    // Every accepted rotation starts a new session generation. A request that
    // was already in flight must not be allowed to apply its cookie or sign
    // this new session out through a late 401.
    sessionGeneration += 1;
    await writeStoredSessionToken(match[1]);
  }
}

// Every request needs the cookie, and every screen issues several. Reading it
// from SecureStore each time put a native round trip in front of every fetch;
// the value only changes when a response rotates it or the session is cleared.
let sessionToken: string | null | undefined;
let sessionTokenRead: Promise<string | null> | null = null;
/**
 * Bumped whenever the session identity is replaced (login dispatch, cookie
 * rotation or clear). Requests capture it at dispatch so late responses can be
 * associated with the session that actually sent them.
 */
let sessionGeneration = 0;

const unauthorizedListeners = new Set<
  (usedToken: string | null, usedGeneration: number) => void
>();

const verificationRequiredListeners = new Set<() => void>();

/**
 * Fires when a write is refused because the account is read-only. The auth
 * provider refreshes `/me` so the banner and verification screen reflect the
 * latest status instead of an old snapshot.
 */
export function subscribeVerificationRequired(listener: () => void): () => void {
  verificationRequiredListeners.add(listener);
  return () => {
    verificationRequiredListeners.delete(listener);
  };
}

function notifyVerificationRequired(data: unknown): void {
  if ((data as { code?: string } | null)?.code !== 'verification_required') return;
  verificationRequiredListeners.forEach((listener) => listener());
}

/**
 * Fires when the API rejects the session (outside the login route, where a 401
 * means "wrong password", not "signed out"). The listener also receives the
 * cookie and generation the failed request used: a response that lands after
 * the member has signed in again must not clear the new session.
 */
export function subscribeUnauthorized(
  listener: (usedToken: string | null, usedGeneration: number) => void,
): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

function notifyUnauthorized(usedToken: string | null, usedGeneration: number): void {
  unauthorizedListeners.forEach((listener) => listener(usedToken, usedGeneration));
}

/** The cookie currently held in memory (undefined = still loading). */
export function peekSessionToken(): string | null | undefined {
  return sessionToken;
}

/** The current session generation (see `sessionGeneration`). */
export function peekSessionGeneration(): number {
  return sessionGeneration;
}

/**
 * Upload a file as multipart/form-data.
 * Uses the same session-cookie mechanism as apiFetch, but does NOT set
 * Content-Type so that fetch can inject the multipart boundary automatically.
 *
 * `method` defaults to POST; the settings PATCH is multipart too (the photo
 * rides the same form as the fields it belongs to), so callers can pick it.
 */
export async function apiFormUpload<T = unknown>(
  path: string,
  formData: FormData,
  signal?: AbortSignal,
  method: 'POST' | 'PATCH' = 'POST'
): Promise<{ data: T; status: number }> {
  const dispatchGeneration = sessionGeneration;
  const sessionToken = await getStoredSession();
  const cookieHeader = sessionToken
    ? `${SESSION_COOKIE_NAME}=${sessionToken}`
    : undefined;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: formData,
    ...(signal ? { signal } : {}),
  });

  const setCookie = response.headers.get('set-cookie');
  if (setCookie && shouldApplySessionCookie(dispatchGeneration, sessionGeneration)) {
    await saveSessionCookie(setCookie);
  }

  let data: T;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    data = (await response.json()) as T;
  } else {
    data = (await response.text()) as unknown as T;
  }

  if (!response.ok) {
    if (response.status === 401 && path !== '/api/auth/login') {
      notifyUnauthorized(sessionToken, dispatchGeneration);
    }
    if (response.status === 403) notifyVerificationRequired(data);
    const message =
      (data as { error?: string })?.error ?? `HTTP ${response.status}`;
    const error = new Error(message) as Error & { status: number; data: unknown };
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return { data, status: response.status };
}

/** Clear a persisted session (on logout or 401). */
export async function clearSession(): Promise<void> {
  sessionToken = null;
  sessionTokenRead = null;
  sessionGeneration += 1;
  await clearStoredSessionToken();
}

/** Retrieve the stored session token (or null). */
export async function getStoredSession(): Promise<string | null> {
  if (sessionToken !== undefined) return sessionToken;
  if (sessionTokenRead) return sessionTokenRead;

  const startedGeneration = sessionGeneration;
  const request = (async () => {
    const current = await readStoredSessionToken();
    // A sign-out/login replaced the session while the native read was in
    // flight. Return the value to the request that needed it, but never cache
    // or migrate it into the new session.
    if (sessionGeneration !== startedGeneration) return current;
    sessionToken = current;
    return current;
  })();

  const tracked = request.finally(() => {
    if (sessionTokenRead === tracked) sessionTokenRead = null;
  });
  sessionTokenRead = tracked;
  return tracked;
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

type FetchOptions = Omit<RequestInit, 'body'> & {
  body?: Record<string, unknown>;
  signal?: AbortSignal;
};

export async function apiFetch<T = unknown>(
  path: string,
  options: FetchOptions = {}
): Promise<{ data: T; status: number }> {
  const { body, headers: extraHeaders = {}, signal, ...rest } = options;

  // A login attempt supersedes every in-flight response from the previous
  // session, including another login attempt.
  if (path === '/api/auth/login') sessionGeneration += 1;
  const dispatchGeneration = sessionGeneration;

  const sessionToken = await getStoredSession();
  const cookieHeader = sessionToken
    ? `${SESSION_COOKIE_NAME}=${sessionToken}`
    : undefined;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    ...(extraHeaders as Record<string, string>),
  };

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...rest,
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
  });
  // Capture session cookie on responses that set one. A late response from an
  // older session must not overwrite the cookie of a newer login.
  const setCookie = response.headers.get('set-cookie');
  if (setCookie && shouldApplySessionCookie(dispatchGeneration, sessionGeneration)) {
    await saveSessionCookie(setCookie);
  }

  let data: T;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    data = (await response.json()) as T;
  } else {
    data = (await response.text()) as unknown as T;
  }

  if (!response.ok) {
    if (response.status === 401 && path !== '/api/auth/login') {
      notifyUnauthorized(sessionToken, dispatchGeneration);
    }
    if (response.status === 403) notifyVerificationRequired(data);
    const message =
      (data as { error?: string })?.error ?? `HTTP ${response.status}`;
    const error = new Error(message) as Error & {
      status: number;
      data: unknown;
    };
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return { data, status: response.status };
}
