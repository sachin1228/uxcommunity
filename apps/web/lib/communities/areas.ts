/**
 * Community areas — the sections of a community's nav. Chat is required and
 * always present; threads, events and resources live in
 * communities.enabled_tabs.
 *
 * Showcase is deliberately *not* in that array. It shipped as an unconditional
 * tab, so every community created before this feature stores an enabled_tabs
 * value without it; membership there cannot tell "never offered" apart from
 * "switched off". It keeps its own flag (communities.showcase_enabled) which
 * defaults to on, so the toggle works for any community — public or private —
 * and a row that predates the flag still shows the tab.
 */

/** Sections stored in communities.enabled_tabs. */
export type CommunityArea = "chat" | "threads" | "events" | "resources";

/** Every section a member can see, in community-nav order. */
export type CommunityFeature = CommunityArea | "showcase";

export const COMMUNITY_AREAS: readonly CommunityArea[] = [
  "chat",
  "threads",
  "events",
  "resources",
];

export const COMMUNITY_FEATURES: readonly CommunityFeature[] = [
  "chat",
  "threads",
  "showcase",
  "events",
  "resources",
];

/** Fallback for a row that predates or omits enabled_tabs. */
export const DEFAULT_ENABLED_TABS: readonly CommunityArea[] = COMMUNITY_AREAS;

/** Showcase is on unless a community explicitly switched it off. */
export function isShowcaseEnabled(showcaseEnabled: boolean | null | undefined): boolean {
  return showcaseEnabled !== false;
}

/** The flags the tab bar needs to decide what a community shows. */
export interface CommunityFeatureFlags {
  enabled_tabs?: readonly string[] | null;
  showcase_enabled?: boolean | null;
}

/** Whether a section belongs in the community's nav. */
export function isFeatureVisible(
  feature: CommunityFeature,
  community: CommunityFeatureFlags,
): boolean {
  if (feature === "showcase") return isShowcaseEnabled(community.showcase_enabled);
  return (community.enabled_tabs ?? DEFAULT_ENABLED_TABS).includes(feature);
}

/**
 * The value to store in enabled_tabs for a set of chosen sections: known areas
 * only (Showcase is stored in its own flag), de-duplicated, in nav order.
 */
export function toEnabledTabs(features: readonly string[]): CommunityArea[] {
  return COMMUNITY_AREAS.filter((area) => features.includes(area));
}
