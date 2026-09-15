/**
 * Community areas — the sections of a community's nav an owner can switch on
 * or off. Kept in one place so the create wizard, community settings, the APIs
 * and the tab bar agree on what exists and who may choose it.
 *
 * Two rules live here:
 *   - Chat is required and always present.
 *   - Showcase is always shown by public communities, so only private
 *     communities get to choose whether they have it.
 */

export type CommunityArea = "chat" | "threads" | "showcase" | "events" | "resources";

/** Every area, in community-nav order. */
export const COMMUNITY_AREAS: readonly CommunityArea[] = [
  "chat",
  "threads",
  "showcase",
  "events",
  "resources",
];

/**
 * Fallback for a community row that predates or omits enabled_tabs — the set of
 * areas communities have always had.
 */
export const DEFAULT_ENABLED_TABS: readonly CommunityArea[] = COMMUNITY_AREAS;

/**
 * Areas that public communities always have, and therefore never offer as a
 * choice to their owner.
 *
 * Showcase is on this list because it shipped as an unconditional tab that was
 * absent from enabled_tabs, so every community created before the toggle has no
 * record of it. Treating it as always-on for public communities keeps those
 * communities exactly as they were.
 */
const PUBLIC_ALWAYS_ON: readonly CommunityArea[] = ["showcase"];

/** Whether an owner may choose this area for a community with this privacy. */
export function isAreaConfigurable(
  area: CommunityArea,
  isPrivate: boolean | null | undefined,
): boolean {
  return isPrivate === true || !PUBLIC_ALWAYS_ON.includes(area);
}

/**
 * Whether the area belongs in the community's nav.
 *
 * Public communities short-circuit the public-only areas, which is what keeps
 * Showcase visible on communities whose stored enabled_tabs never mentioned it.
 */
export function isAreaVisible(
  area: CommunityArea,
  enabledTabs: readonly string[] | null | undefined,
  isPrivate: boolean | null | undefined,
): boolean {
  if (PUBLIC_ALWAYS_ON.includes(area) && isPrivate !== true) return true;
  return (enabledTabs ?? DEFAULT_ENABLED_TABS).includes(area);
}

/**
 * The areas to store for a community: the owner's choices, in nav order, with
 * areas this privacy cannot choose removed.
 */
export function chosenAreas(
  areas: readonly string[] | null | undefined,
  isPrivate: boolean | null | undefined,
): CommunityArea[] {
  const source = areas ?? DEFAULT_ENABLED_TABS;
  return COMMUNITY_AREAS.filter(
    (area) => source.includes(area) && isAreaConfigurable(area, isPrivate),
  );
}
