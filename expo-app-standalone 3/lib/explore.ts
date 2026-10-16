/**
 * Explore — the platform-free half: the browse payload type, the four tabs'
 * row rules (port of `apps/web/lib/communities/explore-filter.ts`) and the
 * recommended/rest split.
 *
 * Nothing here imports React Native or the API client, so the rules run under
 * `tsx --test` on CI (see explore.test.ts). The REST calls live in exploreApi.ts.
 */

/** One row from `GET /api/communities/all` (DB function `get_all_communities`). */
export interface ExploreCommunity {
  id: string;
  name: string;
  type: string;
  image_url: string | null;
  lottie_url?: string | null;
  lottie_format?: string | null;
  description: string | null;
  is_private: boolean;
  member_count: number;
  joined: boolean;
  /** The server's join eligibility (profile-gated types compare the profile). */
  can_join: boolean;
  has_pending_request: boolean;
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
 * Communities the server provisions from the member's own profile fields
 * (their city, sector, experience level, job title). They are joined by
 * profile match rather than by browsing, so Explore never lists them.
 */
const PROFILE_MIRROR_TYPES = new Set(['sector', 'city', 'experience_level', 'job_title']);

/** Public is the absence of the private flag: a row written before `is_private`
 * existed reads as public, which is also how the name badges read it. */
function isPrivate(community: ExploreCommunity): boolean {
  return community.is_private === true;
}

/**
 * The rows a tab shows, in list order.
 *
 * - `all`, `public` and `private` browse the same discovery list; the privacy
 *   tabs narrow it rather than filtering a different set, so a row hidden on
 *   All (joined, profile-mirror) is hidden on both.
 * - `requests` is the member's own pending private-community requests, so it
 *   is the one tab where a row the member already asked to join still appears.
 */
export function visibleExploreRows(
  rows: readonly ExploreCommunity[],
  tab: ExploreTabValue,
  search: string,
): ExploreCommunity[] {
  const term = search.trim().toLowerCase();
  const matchesSearch = (community: ExploreCommunity) =>
    community.name.toLowerCase().includes(term);

  return rows.filter((community) => {
    if (tab === 'requests') return community.has_pending_request && matchesSearch(community);
    if (community.joined) return false;
    if (PROFILE_MIRROR_TYPES.has(community.type)) return false;
    if (tab === 'public' && isPrivate(community)) return false;
    if (tab === 'private' && !isPrivate(community)) return false;
    return matchesSearch(community);
  });
}

/**
 * The section split of a browse tab: everything the member can join now is
 * "Recommended for you"; the rest (locked by profile) falls under the second
 * heading, exactly like the web page's two lists.
 */
export function splitExploreRows(rows: readonly ExploreCommunity[]): {
  recommended: ExploreCommunity[];
  rest: ExploreCommunity[];
} {
  const recommended: ExploreCommunity[] = [];
  const rest: ExploreCommunity[] = [];
  for (const community of rows) {
    if (community.can_join) recommended.push(community);
    else rest.push(community);
  }
  return { recommended, rest };
}

/** "1,234 members" — same formatting the web card uses. */
export function memberCountLabel(count: number): string {
  const formatted = count.toLocaleString('en-US');
  return `${formatted} ${count === 1 ? 'member' : 'members'}`;
}
