import type { CachedExploreCommunity } from "./cache";

/**
 * Master-data communities the member is in automatically (their city, sector,
 * experience level, job title). They are not browsable in Explore.
 */
const HIDDEN_TYPES = new Set(["sector", "city", "experience_level", "job_title"]);

export type ExploreTab = "all" | "interest" | "user";

/**
 * Whether a community's card belongs in the Explore list.
 *
 * Already-joined communities are hidden — the list is for finding new ones —
 * with one exception: a community the member joined *during this visit* keeps
 * its card, because removing it the instant they click is the only feedback
 * they would get. The card stays put and switches to its "Joined" state, which
 * is also the shortcut into the community they just joined.
 */
export function isExploreVisible(
  community: CachedExploreCommunity,
  tab: ExploreTab,
  search: string,
  justJoinedIds: ReadonlySet<string>,
): boolean {
  if (community.joined && !justJoinedIds.has(community.id)) return false;
  if (HIDDEN_TYPES.has(community.type)) return false;

  const matchesTab = tab === "all" || community.type === tab;
  const matchesSearch = community.name
    .toLowerCase()
    .includes(search.trim().toLowerCase());
  return matchesTab && matchesSearch;
}
