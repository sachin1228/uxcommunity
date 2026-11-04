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
export const HOME_FEED_SCOPE_COOKIE = "uxcommunity_feed_scope";
const SCOPE_CHANGED = "uxcommunity:home-feed-scope-changed";

/** Topic the Feed links dispatch on a same-route re-click (see
 *  `RECLICK_REFRESH_EVENT`); the mounted feed refetches its own list. */
export const HOME_FEED_RECLICK_TOPIC = "feed";

export function subscribeHomeFeedScope(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener(SCOPE_CHANGED, listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener(SCOPE_CHANGED, listener);
  };
}

export function homeFeedScopeFromCookie(value?: string): HomeFeedFilterScope {
  return value === "communities" ? value : DEFAULT_HOME_FEED_SCOPE;
}

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
  try {
    document.cookie = `${HOME_FEED_SCOPE_COOKIE}=${scope}; Path=/; Max-Age=31536000; SameSite=Lax${window.location?.protocol === "https:" ? "; Secure" : ""}`;
  } catch { /* Cookies may be disabled independently of localStorage. */ }
  try { window.dispatchEvent(new Event(SCOPE_CHANGED)); } catch { /* Optional storage notification. */ }
}
