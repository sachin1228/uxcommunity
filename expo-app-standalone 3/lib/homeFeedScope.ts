/**
 * The Home feed's source axis — the mobile counterpart of the web dashboard's
 * `lib/feeds/home-feed-options.ts`.
 *
 * The two tabs are disjoint:
 *   `public` ("Public Posts") — cards shared publicly, and only from
 *      communities the member has *not* joined (those have their own tab);
 *   `communities` ("Your Communities") — every card from the communities the
 *      member has joined, whether or not it was shared publicly.
 *
 * The server also accepts `all` — every public card, no membership filter — as
 * the pre-split default for clients that send no scope. The app never offers
 * it; it is the feed the two tabs replace.
 */

export const HOME_FEED_TAB_SCOPES = ['communities', 'public'] as const;

export type HomeFeedScope = (typeof HOME_FEED_TAB_SCOPES)[number];

/** The tab every session opens on when it has no stored choice. */
export const DEFAULT_HOME_FEED_SCOPE: HomeFeedScope = 'communities';

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
