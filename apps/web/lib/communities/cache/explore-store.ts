/**
 * The Explore communities list cache.
 *
 * WHY THIS EXISTS
 *   Explore is its own list projection with its own staleness (5 minutes, versus
 *   the sidebar's 1) and its own listeners, built from a different endpoint. It
 *   was one of several unrelated caches sharing a single 771-line module, so its
 *   lifetime had to be inferred from code about chats and reactions.
 *
 * WHERE THE STATE AND ITS WRITERS LIVE
 *   The state is here, and so is the one way to change it: `setExploreCommunities`
 *   (a fetched first page), `appendExploreCommunities` (the next page, appended
 *   as it arrives) and `notifyExploreStoreChanged` (a surgical patch, called by
 *   the join/leave invalidations in ./sidebar-store.ts because those change both
 *   list projections at once). Both announce on EXPLORE_STORE_CHANGED_EVENT, so a
 *   component subscribes instead of copying rows into its own state — a copy is
 *   what let the Explore list keep offering "Request to join" for a community the
 *   member had already asked to join from the home feed.
 *
 *   The list is PAGED now (see lib/communities/explore-cursor.ts): the directory
 *   is read a page at a time, so the store also holds where the member has read
 *   up to. That position lives here rather than in the page's component state for
 *   the same reason the rows do — a second reader (or a remount) must see the
 *   same list AND the same place in it, and there is only one copy of each.
 */

import { mergeExploreRows } from "../explore-cursor";
import type { CachedExploreCommunity } from "./types";

/** Where the member has read up to in the directory. */
export interface ExplorePage {
  /** The last loaded row's cursor — what the next request pages from. */
  cursor: string | null;
  /** Whether the server said the directory continues past the loaded rows. */
  hasMore: boolean;
}

/** The first page's reading position: nothing loaded, nothing known beyond it. */
const FIRST_PAGE: ExplorePage = { cursor: null, hasMore: false };

export const exploreStore: {
  data: { communities: CachedExploreCommunity[]; fetchedAt: number } | null;
  /** The reading position of `data` — see ExplorePage. */
  page: ExplorePage;
  inflight: Promise<void> | null;
} = { data: null, page: FIRST_PAGE, inflight: null };

export const EXPLORE_STALE_MS = 5 * 60_000;

/** Fired whenever the cached rows change, so listeners re-read them. */
export const EXPLORE_STORE_CHANGED_EVENT = "uxcommunity:explore-store-changed";

/**
 * Replaces the cached rows with a fetched FIRST page (a fetch landed, or a
 * refresh restarted the list) and tells the listeners.
 *
 * The reading position resets with the rows: a refreshed list is a new list, and
 * keeping the old cursor beside it would page from a row the member may no
 * longer be looking at.
 */
export function setExploreCommunities(
  communities: CachedExploreCommunity[],
  options: { fetchedAt?: number; page?: ExplorePage } = {},
): void {
  exploreStore.data = { communities, fetchedAt: options.fetchedAt ?? Date.now() };
  exploreStore.page = options.page ?? FIRST_PAGE;
  notifyExploreStoreChanged();
}

/**
 * Appends the NEXT page to the rows already loaded, and advances the reading
 * position to `page`.
 *
 * Order and uniqueness are `mergeExploreRows`' business (a community whose name
 * changed between two reads can arrive twice across a page seam). A page that
 * empties the list out is impossible by construction — appending never removes a
 * row — so a member who has scrolled deep never loses what they scrolled past.
 *
 * With no list loaded yet, the page simply becomes the list: that is what a
 * direct read of page two means (a restore, or a reader that mounted mid-list).
 * The rows keep the first-page timestamp's meaning — when this list was read —
 * so the staleness window still counts from when the data arrived.
 */
export function appendExploreCommunities(
  incoming: CachedExploreCommunity[],
  page: ExplorePage,
): void {
  const data = exploreStore.data;
  exploreStore.data = {
    communities: data ? mergeExploreRows(data.communities, incoming) : [...incoming],
    fetchedAt: data?.fetchedAt ?? Date.now(),
  };
  exploreStore.page = page;
  notifyExploreStoreChanged();
}

/**
 * Forget the list and the reading position — a user change, or a full
 * invalidation. One function rather than two writes at each call site, because
 * a position left behind by a logout is the next user's page two.
 */
export function resetExploreStore(): void {
  exploreStore.data = null;
  exploreStore.page = FIRST_PAGE;
  exploreStore.inflight = null;
}

export function notifyExploreStoreChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(EXPLORE_STORE_CHANGED_EVENT));
  }
}
