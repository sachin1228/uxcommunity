import type { CachedExploreCommunity } from "@/lib/communities/cache";

/**
 * Types the sidebar is allowed to suggest.
 *
 * Matches Explore: city / sector / experience level / job title communities are
 * pinned to a member's profile (you can only join the one that matches), so
 * suggesting them in the sidebar would offer communities the viewer is locked
 * out of. Interest, general and member-led communities are open to everyone.
 */
const SUGGESTIBLE_TYPES = new Set(["interest", "general", "user"]);

/** Case-insensitive "does this community belong in the current search?" */
export function matchesCommunitySearch(name: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return !needle || name.toLowerCase().includes(needle);
}

/**
 * Picks the communities to show under "Suggested": not already joined, open to
 * the viewer, matching the search box, in the order Explore returned them
 * (alphabetical from the RPC) and capped so the sidebar stays short.
 *
 * `joinedIds` comes from the sidebar list itself rather than the row's own
 * `joined` flag, because a community joined moments ago is patched into the
 * sidebar store optimistically while the explore snapshot still says
 * `joined: false`.
 */
export function selectSuggestedCommunities(
  all: CachedExploreCommunity[],
  joinedIds: ReadonlySet<string>,
  query: string,
  limit = 6,
): CachedExploreCommunity[] {
  const suggestions: CachedExploreCommunity[] = [];
  for (const community of all) {
    if (suggestions.length >= limit) break;
    if (community.joined || joinedIds.has(community.id)) continue;
    if (!community.can_join || !SUGGESTIBLE_TYPES.has(community.type)) continue;
    if (!matchesCommunitySearch(community.name, query)) continue;
    suggestions.push(community);
  }
  return suggestions;
}
