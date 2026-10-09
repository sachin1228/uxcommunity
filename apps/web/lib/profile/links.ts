/**
 * Where a member's avatar or name points when clicked. A member's own id
 * lands on `/dashboard/profile/[userId]`, whose page redirects back to the
 * editable `/dashboard/profile` — callers never need to know the viewer.
 */
export function profileHref(userId: string): string {
  return `/dashboard/profile/${encodeURIComponent(userId)}`;
}

/** Route ids are uuids; a non-uuid would reach Postgres as an invalid uuid literal before any query could answer. */
const PROFILE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isProfileId(value: string): boolean {
  return PROFILE_ID_RE.test(value);
}
