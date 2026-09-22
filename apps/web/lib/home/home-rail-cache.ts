/**
 * Cache tags for the homepage rail's two lists (see
 * lib/home/home-sidebar-server.ts).
 *
 * They live in their own module, like the home feed's tag, because route
 * handlers may only export HTTP handlers — a tag that mutations need to
 * revalidate has to be importable from somewhere else.
 */

/** The week's post-engagement build. Rebuilt by TTL; nothing revalidates it. */
export const TRENDING_POSTS_TAG = "home-trending-posts";

/**
 * The per-member suggestion list. `POST /api/communities/[id]/join` revalidates
 * this tag so a member is never offered a community they just joined.
 */
export const SUGGESTED_COMMUNITIES_TAG = "home-suggested-communities";
