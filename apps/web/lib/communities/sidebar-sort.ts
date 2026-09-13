import type { CachedSidebarCommunity } from "./cache";

/**
 * A community's position in "Your Community" is decided by its most recent
 * activity: the newer of its last message and the moment the current member
 * joined.
 *
 * The join timestamp is what makes a freshly joined community visible. It has
 * no messages yet, so judging by messages alone would sort it below every
 * community that has ever been talked in — the join would look like it did
 * nothing, which is exactly the feedback the member is looking for.
 */
function activityAt(community: CachedSidebarCommunity): string {
  const candidates = [community.last_message?.created_at, community.joined_at]
    .filter((value): value is string => Boolean(value))
    .sort();
  return candidates.at(-1) ?? "";
}

/** Newest activity first, ties broken by name so the order is stable. */
export function sortSidebarCommunities(
  communities: CachedSidebarCommunity[],
): CachedSidebarCommunity[] {
  return [...communities].sort((a, b) => {
    const ta = activityAt(a);
    const tb = activityAt(b);
    if (tb > ta) return 1;
    if (ta > tb) return -1;
    return a.name.localeCompare(b.name);
  });
}
