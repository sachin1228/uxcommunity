/**
 * Explore's community list — the mobile counterpart of the web's
 * `lib/communities/explore-filter.ts` and its `CachedExploreCommunity` row.
 *
 * Which tab hides what is the part worth pinning down, so it lives here as a
 * pure function with a plain-Node test rather than inline in the screen's JSX:
 * profile-mirror communities are never browsable, a joined community belongs
 * to the Chat tab, and "Requests sent" is a different list rather than a slice
 * of the discovery one.
 *
 * The network half lives in `exploreCommunitiesApi.ts`; this module imports
 * nothing from React Native.
 */

/** One row of `GET /api/communities/all` — the same facts the join sheet reads. */
export interface ExploreCommunity {
  id: string;
  name: string;
  /** `city` / `sector` / `experience_level` / `job_title` / `user` / `event`. */
  type: string;
  image_url: string | null;
  description: string | null;
  is_private?: boolean | null;
  member_count: number;
  joined: boolean;
  /** Whether this member can join outright, by their own profile fields. */
  can_join: boolean;
  /** A pending request for a private community, sent from anywhere. */
  has_pending_request?: boolean;
}

/**
 * The pill order is the contract: privacy filters sit between All and the
 * requests tab, and "Requests sent" stays last because it is not a privacy
 * filter at all — it is the member's own outgoing join requests.
 */
export const EXPLORE_TABS = [
  { label: 'All', value: 'all' },
  { label: 'Public', value: 'public' },
  { label: 'Private', value: 'private' },
  { label: 'Requests sent', value: 'requests' },
] as const;

export type ExploreTabValue = (typeof EXPLORE_TABS)[number]['value'];

/**
 * Communities the server provisions from the member's own profile fields (their
 * city, sector, experience level, job title). They are joined by profile match
 * rather than by browsing, so Explore never lists them — on any tab.
 */
const PROFILE_MIRROR_TYPES = new Set(['sector', 'city', 'experience_level', 'job_title']);

/** Public is the absence of the private flag: a row written before `is_private`
 * existed reads as public, which is also how the name badges read it. */
export function isPrivateCommunity(c: ExploreCommunity): boolean {
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
  rows: readonly ExploreCommunity[],
  tab: ExploreTabValue,
  search: string,
): ExploreCommunity[] {
  const term = search.trim().toLowerCase();
  const matchesSearch = (c: ExploreCommunity) => c.name.toLowerCase().includes(term);

  return rows.filter((c) => {
    if (tab === 'requests') return Boolean(c.has_pending_request) && matchesSearch(c);
    if (c.joined) return false;
    if (PROFILE_MIRROR_TYPES.has(c.type)) return false;
    if (tab === 'public' && isPrivateCommunity(c)) return false;
    if (tab === 'private' && !isPrivateCommunity(c)) return false;
    return matchesSearch(c);
  });
}

/**
 * The two sections the discovery tabs split their rows into: the member can
 * join the first outright, the rest need a request, an invite or a profile
 * change. The second heading only reads "All communities" on the All tab.
 */
export function splitExploreRows(rows: readonly ExploreCommunity[]): {
  recommended: ExploreCommunity[];
  rest: ExploreCommunity[];
} {
  return {
    recommended: rows.filter((c) => c.can_join),
    rest: rows.filter((c) => !c.can_join),
  };
}
