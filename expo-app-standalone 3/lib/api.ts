/**
 * Base API client for the web app backend.
 *
 * Session management: the web backend issues an HttpOnly JWT cookie named
 * `draft_session`. React Native can read `Set-Cookie` response headers from
 * native fetch, so we capture the token value and replay it as a Cookie header
 * on every subsequent request.
 *
 * Configure EXPO_PUBLIC_API_URL in your .env / EAS secrets, e.g.:
 *   EXPO_PUBLIC_API_URL=https://your-web-app.vercel.app
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const SESSION_COOKIE_NAME = 'draft_session';
const SESSION_STORAGE_KEY = '@auth/draft_session';

export const API_BASE_URL =
  (process.env.EXPO_PUBLIC_API_URL ?? '').replace(/\/$/, '');

// ---------------------------------------------------------------------------
// Cookie helpers
// ---------------------------------------------------------------------------

/** Persist the draft_session cookie value extracted from a Set-Cookie header. */
async function saveSessionCookie(setCookieHeader: string): Promise<void> {
  // Format: draft_session=<value>; Path=/; HttpOnly; ...
  const match = setCookieHeader.match(
    new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`)
  );
  if (match?.[1]) {
    await AsyncStorage.setItem(SESSION_STORAGE_KEY, match[1]);
  }
}

/**
 * Upload a file as multipart/form-data.
 * Uses the same session-cookie mechanism as apiFetch, but does NOT set
 * Content-Type so that fetch can inject the multipart boundary automatically.
 */
export async function apiFormUpload<T = unknown>(
  path: string,
  formData: FormData
): Promise<{ data: T; status: number }> {
  const sessionToken = await getStoredSession();
  const cookieHeader = sessionToken
    ? `${SESSION_COOKIE_NAME}=${sessionToken}`
    : undefined;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: formData,
  });

  const setCookie = response.headers.get('set-cookie');
  if (setCookie) await saveSessionCookie(setCookie);

  let data: T;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    data = (await response.json()) as T;
  } else {
    data = (await response.text()) as unknown as T;
  }

  if (!response.ok) {
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
  await AsyncStorage.removeItem(SESSION_STORAGE_KEY);
}

/** Retrieve the stored session token (or null). */
export async function getStoredSession(): Promise<string | null> {
  return AsyncStorage.getItem(SESSION_STORAGE_KEY);
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

type FetchOptions = Omit<RequestInit, 'body'> & {
  body?: Record<string, unknown>;
};

export async function apiFetch<T = unknown>(
  path: string,
  options: FetchOptions = {}
): Promise<{ data: T; status: number }> {
  const { body, headers: extraHeaders = {}, ...rest } = options;

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
  });

  // Capture session cookie on responses that set one
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) {
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
