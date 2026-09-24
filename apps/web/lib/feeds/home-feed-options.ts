/**
 * The feed source axis of the homepage feed, shared by the switcher UI, the
 * API route and the request cache keys:
 *
 * scope — which cards are eligible. The two tabs are disjoint:
 *   `communities` ("Your Communities") — every card from the communities the
 *      member has joined, whether or not it was shared publicly;
 *   `public` ("For You") — cards shared publicly, and only from
 *      communities the member has *not* joined (those have their own tab).
 *
 * `all` is the legacy scope: every public card, no membership filter. It is the
 * server default for clients that send no scope (the Expo home feed, older web
 * builds, the load tests) so their feed is unchanged, and it is never offered
 * in the switcher.
 */

export const HOME_FEED_SCOPES = ["all", "communities", "public"] as const;
export type HomeFeedScope = (typeof HOME_FEED_SCOPES)[number];

/** The scopes the dashboard switcher offers, in tab order. */
export const HOME_FEED_TAB_SCOPES = ["public", "communities"] as const;

/** The tab every session opens on when it has no stored choice. */
export const DEFAULT_HOME_FEED_SCOPE: HomeFeedScope = "public";

/** Scopes are stored per member so returning to the dashboard keeps the choice. */
export const HOME_FEED_SCOPE_STORAGE_KEY = "uxcommunity:home-feed-scope";

export function isHomeFeedScope(value: unknown): value is HomeFeedScope {
  return typeof value === "string" && (HOME_FEED_SCOPES as readonly string[]).includes(value);
}

export function readStoredHomeFeedScope(): HomeFeedScope | null {
  try {
    const value = window.localStorage.getItem(HOME_FEED_SCOPE_STORAGE_KEY);
    if (!isHomeFeedScope(value)) return null;
    // Sessions that stored the old `all` choice (the pre-split "everything
    // public" feed) land on the feed that replaced it.
    return value === "all" ? DEFAULT_HOME_FEED_SCOPE : value;
  } catch {
    return null;
  }
}

export function storeHomeFeedScope(scope: HomeFeedScope): void {
  try {
    window.localStorage.setItem(HOME_FEED_SCOPE_STORAGE_KEY, scope);
  } catch {
    // Storage unavailable — the choice just won't persist.
  }
}
