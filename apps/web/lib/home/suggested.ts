/**
 * Which communities the homepage rail suggests to a member.
 *
 * Pure selection rules, unit tested without a database. The caller
 * (home-sidebar-server.ts) supplies the same row shape the Explore page reads
 * from `get_all_communities`, so the two surfaces can never disagree about who
 * is allowed into a community.
 */

/** Communities shown in the card. */
export const SUGGESTION_LIMIT = 4;

/**
 * Community types worth suggesting. Profile-derived communities (city, sector,
 * experience level, job title) are deliberately out: a member can only join the
 * ones their profile already matches, and they are auto-joined at signup, so
 * they are never a discovery. `general` is excluded for the same reason — every
 * member is in it.
 */
const SUGGESTABLE_TYPES: ReadonlySet<string> = new Set(["interest", "user"]);

export interface SuggestedCommunitySource {
  id: string;
  name: string;
  type: string;
  image_url: string | null;
  description: string | null;
  is_private: boolean;
  member_count: number;
  joined: boolean;
  can_join: boolean;
}

export interface SuggestedCommunity {
  id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  member_count: number;
}

/**
 * Picks the communities to suggest, biggest first.
 *
 * Only open, joinable communities the member is not already in are eligible —
 * anything else would render a Join button that cannot work. Private
 * communities are skipped because joining one is a request the owner has to
 * approve, which is not what a one-tap "Join" promises.
 */
export function pickSuggestedCommunities(
  communities: readonly SuggestedCommunitySource[],
  limit: number = SUGGESTION_LIMIT,
): SuggestedCommunity[] {
  return communities
    .filter(
      (community) =>
        !community.joined &&
        community.can_join &&
        !community.is_private &&
        SUGGESTABLE_TYPES.has(community.type),
    )
    .sort(
      (a, b) =>
        b.member_count - a.member_count ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, Math.max(limit, 0))
    .map((community) => ({
      id: community.id,
      name: community.name,
      description: community.description,
      image_url: community.image_url,
      member_count: community.member_count,
    }));
}
