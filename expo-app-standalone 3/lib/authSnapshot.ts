/**
 * The signed-in member's last known profile, persisted so a returning launch
 * can render the app shell and the member's own surfaces immediately while
 * `/api/auth/me` revalidates the cookie in the background.
 *
 * This is a display snapshot, never an authorization source: every API call
 * still rides the HttpOnly-derived session cookie and the server remains the
 * only side that decides what the member may do. A malformed, stale or
 * account-mismatched snapshot is discarded by the validator below.
 */

import type { User } from './auth';

export const AUTH_USER_STORAGE_KEY = '@auth/user_snapshot';

function isUser(value: unknown): value is User {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    row.id.length > 0 &&
    typeof row.name === 'string' &&
    typeof row.email === 'string' &&
    (row.role === 'user' || row.role === 'admin') &&
    typeof row.profileComplete === 'boolean' &&
    (row.avatar_url === null || typeof row.avatar_url === 'string')
  );
}

/** A usable snapshot, or null for missing/corrupt/legacy state. */
export function parseAuthSnapshot(raw: string | null): User | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isUser(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function serializeAuthSnapshot(user: User): string | null {
  // Admin sessions from /api/auth/me carry no id; there is nothing stable to
  // key a snapshot to, and their next launch revalidates like any other.
  if (!user.id) return null;
  return JSON.stringify(user);
}
