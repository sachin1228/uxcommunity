/**
 * Cache tag for the homepage rail's list (see lib/home/home-sidebar-server.ts).
 *
 * It lives in its own module, like the home feed's tag, because route handlers
 * may only export HTTP handlers — a tag that mutations need to revalidate has to
 * be importable from somewhere else.
 */

/**
 * The per-member suggestion list. `POST /api/communities/[id]/join` revalidates
 * this tag so a member is never offered a community they just joined.
 */
export const SUGGESTED_COMMUNITIES_TAG = "home-suggested-communities";
