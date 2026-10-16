/**
 * The home feed's scope axis — a port of `apps/web/lib/feeds/home-feed-options.ts`.
 *
 * The two tabs are disjoint:
 *   `communities` ("Your Communities") — every card from the communities the
 *      member has joined, whether or not it was shared publicly;
 *   `public` ("Public Posts") — cards shared publicly, and only from
 *      communities the member has *not* joined (those have their own tab).
 *
 * `all` is the legacy scope the server defaults to when no scope is sent; it
 * is never offered as a tab, and a stored `all` choice lands on `public`.
 */

export const HOME_FEED_TAB_SCOPES = ['public', 'communities'] as const;

export type HomeFeedTabScope = (typeof HOME_FEED_TAB_SCOPES)[number];

/** The tab every session opens on when it has no stored choice. */
export const DEFAULT_HOME_FEED_TAB_SCOPE: HomeFeedTabScope = 'public';

/** Same key name the web build uses, so the choice is one concept on both. */
export const HOME_FEED_SCOPE_STORAGE_KEY = 'uxcommunity:home-feed-scope';

export const HOME_FEED_SCOPE_LABELS: Record<HomeFeedTabScope, string> = {
  public: 'Public Posts',
  communities: 'Your Communities',
};

/**
 * A stored value → the tab it means. Sessions that stored the old `all`
 * choice (the pre-split "everything public" feed) land on the feed that
 * replaced it; unknown values fall back to the default.
 */
export function normalizeStoredHomeFeedScope(value: string | null | undefined): HomeFeedTabScope {
  if (value === 'communities') return 'communities';
  return DEFAULT_HOME_FEED_TAB_SCOPE;
}
