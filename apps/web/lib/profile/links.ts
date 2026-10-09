/**
 * Where a member's avatar or name points when clicked. A member's own id
 * lands on `/dashboard/profile/[userId]`, whose page redirects back to the
 * editable `/dashboard/profile` — callers never need to know the viewer.
 */
export function profileHref(userId: string): string {
  return `/dashboard/profile/${encodeURIComponent(userId)}`;
}
