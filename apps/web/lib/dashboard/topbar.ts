/**
 * Topbar logic for the member dashboard: what the search palette can reach, and
 * which key hint to show for it.
 *
 * Deliberately free of React and of any data fetching. The palette is a filter
 * over a list built from the caller's own communities, so it is unit-testable
 * without a DOM (see topbar.test.ts).
 *
 * There is no server-side search in this app, so the palette does not pretend
 * to be one: it jumps to pages the member already has and to the communities
 * the sidebar cache has already fetched.
 */

/** Which list a palette row belongs to — the palette renders one header per group. */
export type SearchGroup = "page" | "community";

export interface SearchDestination {
  /** Stable key for React lists and for `aria-activedescendant` in the palette. */
  id: string;
  label: string;
  href: string;
  group: SearchGroup;
  /** Extra words that should also match this row, beyond its label. */
  keywords: string[];
}

/** Pages the palette can always reach, in the order it lists them. */
export const PAGE_DESTINATIONS: SearchDestination[] = [
  {
    id: "page:home",
    label: "Home",
    href: "/dashboard",
    group: "page",
    keywords: ["feed", "homepage", "dashboard"],
  },
  {
    id: "page:communities",
    label: "Explore Communities",
    href: "/dashboard/communities",
    group: "page",
    keywords: ["discover", "explore", "browse", "join"],
  },
  {
    id: "page:library",
    label: "Library",
    href: "/dashboard/library",
    group: "page",
    keywords: ["saved", "bookmarks", "collection"],
  },
  {
    id: "page:jobs",
    label: "Jobs",
    href: "/dashboard/jobs",
    group: "page",
    keywords: ["hiring", "roles", "careers", "work"],
  },
  {
    id: "page:events",
    label: "Events",
    href: "/dashboard/events",
    group: "page",
    keywords: ["calendar", "meetups", "workshops", "city"],
  },
  {
    id: "page:saved",
    label: "Saved",
    href: "/dashboard/saved",
    group: "page",
    // "bookmarks" stays Library's keyword: a query for it must keep finding
    // the Library row the palette has always offered.
    keywords: ["save", "saved"],
  },
  {
    id: "page:notifications",
    label: "Notifications",
    href: "/dashboard/notifications",
    group: "page",
    keywords: ["alerts", "inbox", "unread"],
  },
  {
    id: "page:profile",
    label: "Profile",
    href: "/dashboard/profile",
    group: "page",
    keywords: ["me", "account", "avatar", "activity"],
  },
  {
    id: "page:settings",
    label: "Settings",
    href: "/dashboard/settings",
    group: "page",
    keywords: ["preferences", "account", "password", "notifications"],
  },
];

/** The shape the palette needs from a sidebar community — kept structural so
 * the cache's own row type can be passed straight in. */
export interface SearchableCommunity {
  id: string;
  name: string;
  is_archived?: boolean;
  /** A city / sector / experience-level community's parent value, e.g. "Pune". */
  reference_name?: string | null;
}

export function communityDestination(
  community: SearchableCommunity,
): SearchDestination {
  const parent = community.reference_name?.trim();
  return {
    id: `community:${community.id}`,
    label: community.name,
    href: `/dashboard/communities/${community.id}`,
    group: "community",
    // The parent value is what makes "Pune" or "Product design" findable
    // without a second copy of the community's name.
    keywords: parent ? [parent] : [],
  };
}

/** How many rows the palette shows at once. */
export const SEARCH_RESULT_LIMIT = 10;

/** Pages list above communities; each group is ranked on its own. */
const GROUP_ORDER: Record<SearchGroup, number> = { page: 0, community: 1 };

/**
 * How well one row matches the query, lower being better, or null for no match.
 *
 * A label prefix beats a label substring ("lib" → Library, not Deliberate) and
 * both beat a keyword hit, so searching for a page never loses to a community
 * that merely mentions the word.
 */
function matchRank(destination: SearchDestination, query: string): number | null {
  const label = destination.label.toLowerCase();
  if (label.startsWith(query)) return 0;
  if (label.includes(query)) return 1;

  const keywords = destination.keywords.map((word) => word.toLowerCase());
  if (keywords.some((word) => word.startsWith(query))) return 2;
  if (keywords.some((word) => word.includes(query))) return 3;

  return null;
}

/**
 * The palette's rows for a query. An empty query lists what the member is
 * most likely to want next — the pages, then their communities.
 */
export function searchDestinations(
  query: string,
  communities: readonly SearchableCommunity[] = [],
  limit = SEARCH_RESULT_LIMIT,
): SearchDestination[] {
  const rows = [
    ...PAGE_DESTINATIONS,
    ...communities.filter((c) => !c.is_archived).map(communityDestination),
  ];

  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return rows.slice(0, limit);

  return rows
    .map((destination) => ({ destination, rank: matchRank(destination, trimmed) }))
    .filter(
      (row): row is { destination: SearchDestination; rank: number } =>
        row.rank !== null,
    )
    .sort(
      (a, b) =>
        GROUP_ORDER[a.destination.group] - GROUP_ORDER[b.destination.group] ||
        a.rank - b.rank ||
        a.destination.label.length - b.destination.label.length ||
        a.destination.label.localeCompare(b.destination.label),
    )
    .slice(0, limit)
    .map((row) => row.destination);
}

/**
 * Whether the ⌘ glyph will read as a key on this device. Read through a
 * client-only snapshot rather than during render, so the server and the first
 * client render agree (see Topbar).
 */
export function isApplePlatform(userAgent: string): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(userAgent);
}
