/**
 * Cache tag for the Explore directory's pages (see explore-page-server.ts).
 *
 * It lives in its own module, like the homepage rail's tag, because route
 * handlers may only export HTTP handlers — a tag that mutations need to
 * revalidate has to be importable from somewhere else.
 */

/**
 * Every cached page of the Explore list, for every member.
 *
 * `POST /api/communities/[id]/join` revalidates it (plus
 * SUGGESTED_COMMUNITIES_TAG): a page carries the caller's own `joined` and
 * `has_pending_request` flags, so filing a request or joining has to drop the
 * cached copy or the member would keep being offered a community they just acted
 * on. Revalidating the tag drops all pages, which is the point — the cursor
 * halves are part of the cache key, so there is one entry per page position.
 */
export const EXPLORE_COMMUNITIES_TAG = "explore-communities";

/**
 * How long a directory page may be served from cache.
 *
 * A minute, the same window the rail uses: the Explore page's own client cache
 * is five minutes, so this only ever shortens what the member could already be
 * looking at, and it exists to collapse repeat reads within one visit — not to
 * decide how fresh the directory is.
 */
export const EXPLORE_PAGE_REVALIDATE_SECONDS = 60;
