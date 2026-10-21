/**
 * The Home feed's source axis — the mobile counterpart of the web dashboard's
 * `lib/feeds/home-feed-options.ts`.
 *
 * The two tabs are:
 *   `all` ("All posts") — the default unified feed. Every card from the
 *      communities the member has joined (whether or not it was shared
 *      publicly), plus every publicly shared card from communities they have
 *      not joined.
 *   `communities` ("Your communities") — only cards from joined communities,
 *      public or private.
 *
 * The two tabs partition the same cards: `all` is exactly the union of
 * `communities` and the public cards, so filtering never hides a post from the
 * unified feed or shows the same post twice.
 *
 * The API still accepts the retired `public` scope for older clients; this app
 * does not offer it because those posts are already part of `all`.
 */

export const HOME_FEED_TAB_SCOPES = ['all', 'communities'] as const;

export type HomeFeedScope = (typeof HOME_FEED_TAB_SCOPES)[number];

/** The tab every session opens on when it has no stored choice. */
export const DEFAULT_HOME_FEED_SCOPE: HomeFeedScope = 'all';

/** Storage key for the member's remembered choice (mobile's `@` convention). */
export const HOME_FEED_SCOPE_STORAGE_KEY = '@home-feed/scope';

export function isHomeFeedScope(value: unknown): value is HomeFeedScope {
  return (
    typeof value === 'string' &&
    (HOME_FEED_TAB_SCOPES as readonly string[]).includes(value)
  );
}

/**
 * The slice of AsyncStorage this module needs. Injected so the pure helpers —
 * and their tests — import nothing from React Native.
 */
export interface HomeFeedScopeStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** The stored tab, or null when none was chosen (or storage is unavailable). */
export async function hydrateHomeFeedScope(
  storage: HomeFeedScopeStorage,
): Promise<HomeFeedScope | null> {
  try {
    const value = await storage.getItem(HOME_FEED_SCOPE_STORAGE_KEY);
    if (value === 'public') return DEFAULT_HOME_FEED_SCOPE;
    return isHomeFeedScope(value) ? value : null;
  } catch {
    return null;
  }
}

/** Best effort: a failed write only means the choice won't persist. */
export async function persistHomeFeedScope(
  storage: HomeFeedScopeStorage,
  scope: HomeFeedScope,
): Promise<void> {
  try {
    await storage.setItem(HOME_FEED_SCOPE_STORAGE_KEY, scope);
  } catch {
    // Storage unavailable — the choice just won't persist.
  }
}
