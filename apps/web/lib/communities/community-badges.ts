import { EVENT_CHAT_COMMUNITY_TYPE } from "./event-chat-rules";

/**
 * Classification helpers behind the community name badges.
 *
 * `communities.type` is the only signal that tells a platform community apart
 * from a member-created one, so the rules live here (pure, no React) and are
 * shared by the sidebar, the chat header, the explore cards and the join page.
 */

/**
 * Community types the signup flow creates automatically (`autoJoinCommunities`):
 * one community per profile dimension. These are the communities a member
 * never created, so they are the ones eligible for the verified seal.
 */
export const SIGNUP_COMMUNITY_TYPES = [
  "city",
  "sector",
  "experience_level",
  "job_title",
] as const;

/** Communities a member created themselves from Create Community. */
export const MEMBER_COMMUNITY_TYPE = "user";

export type SignupCommunityType = (typeof SIGNUP_COMMUNITY_TYPES)[number];

/**
 * True for every community the platform creates on the member's behalf —
 * city, sector, experience-level and job-title communities.
 *
 * Member-created communities (`type: "user"`) and unknown types do not qualify:
 * the badge must mean "the platform stands behind this", so the allow-list is
 * explicit rather than "anything that isn't a member community".
 */
export function isSignupCommunity(type: string | null | undefined): boolean {
  return (SIGNUP_COMMUNITY_TYPES as readonly string[]).includes(type ?? "");
}

export type CommunityVisibility = "public" | "private";

export type CommunityVisibilityIcon = "globe" | "lock";

/** Which badges a community name should render, in the order they are drawn. */
export interface CommunityNameBadgeSpec {
  /** The verified seal — platform-created default groups only. */
  verified: boolean;
  /** Earth, lock, or nothing. */
  visibility: CommunityVisibilityIcon | null;
}

/**
 * Public is the absence of the private flag: rows written before `is_private`
 * existed (and any insert that omits it) read as public, matching the column's
 * database default and the join routes' behaviour.
 */
export function communityVisibility(
  isPrivate: boolean | null | undefined,
): CommunityVisibility {
  return isPrivate === true ? "private" : "public";
}

/**
 * The badge pair for one community name:
 *
 * - Platform default group (city, sector, experience level, job title) —
 *   the seal plus the lock: a member joins these only through the signup
 *   match, never by browsing, so they read as closed whatever `is_private`
 *   says.
 * - Member-created communities and event rooms — earth when public, lock
 *   when private, following the community's own setting.
 * - Anything else — nothing, or the lock when private.
 *
 * Unknown types fall through to "nothing but the lock when private" rather than
 * guessing a badge for a community kind the platform does not know yet.
 */
export function communityNameBadges(
  type: string | null | undefined,
  isPrivate: boolean | null | undefined,
): CommunityNameBadgeSpec {
  if (isSignupCommunity(type)) {
    return { verified: true, visibility: "lock" };
  }

  const isPublicGroup = communityVisibility(isPrivate) === "public";

  if (type === MEMBER_COMMUNITY_TYPE || type === EVENT_CHAT_COMMUNITY_TYPE) {
    return { verified: false, visibility: isPublicGroup ? "globe" : "lock" };
  }

  return { verified: false, visibility: isPublicGroup ? null : "lock" };
}
