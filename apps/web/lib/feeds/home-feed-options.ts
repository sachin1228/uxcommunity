/**
 * The feed source axis of the homepage feed, shared by the filter UI, the API
 * route and the request cache keys:
 *
 *   `all` ("All posts") — the default unified feed. Every card from the
 *      communities the member has joined (whether or not it was shared
 *      publicly), plus every publicly shared card from communities they have
 *      not joined.
 *   `communities` ("Your communities") — only cards from joined communities,
 *      public or private.
 *
 * The two filters partition the same cards: `all` is exactly the union of
 * `communities` and the public cards, so filtering never hides a post from the
 * unified feed or shows the same post twice.
 *
 * `public` is kept in HOME_FEED_SCOPES because the API still accepts it for
 * older clients (the pre-unification public tab). The dashboard no longer
 * offers it: those posts are already part of `all`.
 */

export const HOME_FEED_SCOPES = ["all", "communities", "public"] as const;
export type HomeFeedScope = (typeof HOME_FEED_SCOPES)[number];

/** The filters the dashboard currently offers, in order. */
export const HOME_FEED_FILTER_SCOPES = ["all", "communities"] as const;
export type HomeFeedFilterScope = (typeof HOME_FEED_FILTER_SCOPES)[number];

/** The feed every session opens on when it has no stored choice. */
export const DEFAULT_HOME_FEED_SCOPE: HomeFeedFilterScope = "all";

/** The chosen filter is stored per browser so returning visits keep it. */
export const HOME_FEED_SCOPE_STORAGE_KEY = "uxcommunity:home-feed-scope";

export function isHomeFeedScope(value: unknown): value is HomeFeedScope {
  return typeof value === "string" && (HOME_FEED_SCOPES as readonly string[]).includes(value);
}

export function isHomeFeedFilterScope(value: unknown): value is HomeFeedFilterScope {
  return typeof value === "string" && (HOME_FEED_FILTER_SCOPES as readonly string[]).includes(value);
}

export function readStoredHomeFeedScope(): HomeFeedFilterScope | null {
  try {
    const value = window.localStorage.getItem(HOME_FEED_SCOPE_STORAGE_KEY);
    // Sessions that stored the removed public filter land on the unified feed
    // that contains those posts.
    if (value === "public") return DEFAULT_HOME_FEED_SCOPE;
    return isHomeFeedFilterScope(value) ? value : null;
  } catch {
    return null;
  }
}

export function storeHomeFeedScope(scope: HomeFeedFilterScope): void {
  try {
    window.localStorage.setItem(HOME_FEED_SCOPE_STORAGE_KEY, scope);
  } catch {
    // Storage unavailable — the choice just won't persist.
  }
}
