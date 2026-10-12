/**
 * The Explore list's tabs and the rows each one shows.
 *
 * WHY THIS EXISTS
 *   The rule used to be spelled inline in the page's filter callback, which made
 *   "which tab hides what" a question you answered by reading JSX. It is the part
 *   of that page worth pinning down: profile-mirror communities are never
 *   browsable, a joined community belongs to the sidebar, and the requests tab is
 *   a different list rather than a slice of the discovery one.
 */

import type { CachedExploreCommunity } from "./cache/types";

/**
 * The pill order is the contract: privacy filters sit between All and the
 * requests tab, and "Requests sent" stays last because it is not a privacy
 * filter at all — it is the member's own outgoing join requests.
 */
export const EXPLORE_TABS = [
  { label: "All", value: "all" },
  { label: "Public", value: "public" },
  { label: "Private", value: "private" },
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
 * - `all`, `public` and `private` browse the same discovery list; the privacy
 *   tabs narrow it rather than filtering a different set, so a row hidden on All
 *   (joined, profile-mirror) is hidden on both.
 * - `requests` is the member's own pending private-community requests, so it is
 *   the one tab where a row the member already asked to join still appears.
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
    if (tab === "public" && isPrivate(c)) return false;
    if (tab === "private" && !isPrivate(c)) return false;
    return matchesSearch(c);
  });
}
