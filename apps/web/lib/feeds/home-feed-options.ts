/**
 * The feed source axis of the homepage feed, shared by the switcher UI, the
 * API route and the request cache keys:
 *
 * scope — whose posts are eligible: everything public (`all`) or only posts
 * from communities the member belongs to (`communities`).
 */

export const HOME_FEED_SCOPES = ["all", "communities"] as const;
export type HomeFeedScope = (typeof HOME_FEED_SCOPES)[number];

/** Scopes are stored per member so returning to the dashboard keeps the choice. */
export const HOME_FEED_SCOPE_STORAGE_KEY = "uxcommunity:home-feed-scope";

export function isHomeFeedScope(value: unknown): value is HomeFeedScope {
  return typeof value === "string" && (HOME_FEED_SCOPES as readonly string[]).includes(value);
}

export function readStoredHomeFeedScope(): HomeFeedScope | null {
  try {
    const value = window.localStorage.getItem(HOME_FEED_SCOPE_STORAGE_KEY);
    return isHomeFeedScope(value) ? value : null;
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
