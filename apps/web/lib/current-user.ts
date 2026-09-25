"use client";

/**
 * The signed-in member as the comment UI needs them: display name + avatar.
 *
 * Every `CommentComposer` on a page (comment sections, lightboxes, reply boxes)
 * shares one `/api/auth/me` round trip through this memo instead of fetching it
 * per composer.
 *
 * The memo is session state, so it must be dropped when the session changes —
 * `resetCurrentUserSummary` is called from `resetClientSessionCaches` (see
 * lib/session-cache.ts). Without that reset a composer rendered after a logout
 * → login would paint the previous member's name and avatar.
 */

export interface CurrentUserSummary {
  name: string;
  avatar_url: string | null;
}

let cached: CurrentUserSummary | null | undefined;

export async function loadCurrentUserSummary(): Promise<CurrentUserSummary | null> {
  if (cached !== undefined) return cached;
  try {
    const res = await fetch("/api/auth/me");
    const data = (await res.json().catch(() => null)) as
      | { user?: { name?: string; avatar_url?: string | null } }
      | null;
    cached = data?.user?.name
      ? { name: data.user.name, avatar_url: data.user.avatar_url ?? null }
      : null;
  } catch {
    cached = null;
  }
  return cached;
}

/** Forget the memoized identity — the next caller refetches for the new session. */
export function resetCurrentUserSummary(): void {
  cached = undefined;
}
