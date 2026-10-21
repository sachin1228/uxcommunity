/**
 * The Explore list's tabs and the rows each one shows.
 *
 * WHY THIS EXISTS
 *   The rule used to be spelled inline in the page's filter callback, which made
 *   "which tab hides what" a question you answered by reading JSX. It is the part
 *   of that page worth pinning down: private and profile-mirror communities are
 *   never browsable, a joined community belongs to the sidebar, and the requests
 *   tab is a different list rather than a slice of the discovery one.
 */

import type { CachedExploreCommunity } from "./cache/types";

/**
 * Two pills: All browses the public discovery list, and "Requests sent" is the
 * member's own outgoing join requests. Private communities are not listed
 * anywhere in Explore — they are reached by invite or link, not by browsing.
 */
export const EXPLORE_TABS = [
  { label: "All", value: "all" },
  { label: "Requests sent", value: "requests" },
] as const;

export type ExploreTabValue = (typeof EXPLORE_TABS)[number]["value"];

/**
 * Communities the server provisions from the member's own profile fields (their
 * city, sector, experience level, job title). They are joined by profile match
 * rather than by browsing, so Explore never lists them — on any tab.
 */
const PROFILE_MIRROR_TYPES = new Set(["sector", "city", "experience_level", "job_title"]);

/** Public is the absence of the private flag: a row written before `is_private`
 * existed reads as public, which is also how the name badges read it. */
function isPrivate(c: CachedExploreCommunity): boolean {
  return c.is_private === true;
}

/**
 * The rows a tab shows, in list order.
 *
 * - `all` browses the public discovery list: private communities are left out
 *   even when the member already has a pending request for one.
 * - `requests` is the member's own pending join requests, so it is the one tab
 *   where a row the member cannot browse still appears.
 */
export function visibleExploreRows(
  rows: readonly CachedExploreCommunity[],
  tab: ExploreTabValue,
  search: string,
): CachedExploreCommunity[] {
  const term = search.trim().toLowerCase();
  const matchesSearch = (c: CachedExploreCommunity) => c.name.toLowerCase().includes(term);

  return rows.filter((c) => {
    if (tab === "requests") return Boolean(c.has_pending_request) && matchesSearch(c);
    if (c.joined) return false;
    if (PROFILE_MIRROR_TYPES.has(c.type)) return false;
    if (isPrivate(c)) return false;
    return matchesSearch(c);
  });
}
