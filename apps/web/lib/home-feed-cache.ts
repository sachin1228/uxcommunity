/**
 * Cache tag for the home feed's unstable_cache entry (see
 * app/api/home/feed/route.ts). Mutations that change per-user feed state
 * (RSVP, like, save) call revalidateTag(HOME_FEED_TAG, { expire: 0 }) so the
 * next feed read recomputes from the DB instead of serving a pre-mutation
 * snapshot that makes the user's own action appear to revert after refresh.
 *
 * Lives in a lib module because route.ts files may only export HTTP handlers.
 */
export const HOME_FEED_TAG = "home-feed";
