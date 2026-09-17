/**
 * Classification helpers behind the community name badges.
 *
 * `communities.type` is the only signal that tells a platform community apart
 * from a member-created one, so the rules live here (pure, no React) and are
 * shared by the sidebar, the chat header, the explore cards and the join page.
 */

/**
 * Community types the signup flow creates automatically (`autoJoinCommunities`):
 * the always-joined General community plus one community per profile dimension.
 * These are the communities a member never created, so they are the ones
 * eligible for the verified seal (interest communities excepted — see
 * `communityNameBadges`).
 */
export const SIGNUP_COMMUNITY_TYPES = [
  "general",
  "city",
  "sector",
  "interest",
  "experience_level",
  "job_title",
] as const;

/** Communities a member created themselves from Create Community. */
export const MEMBER_COMMUNITY_TYPE = "user";

/**
 * The one signup-created type that does NOT use the seal: interest communities
 * are topic groups a member browses and joins, so they carry the earth instead.
 */
export const INTEREST_COMMUNITY_TYPE = "interest";

export type SignupCommunityType = (typeof SIGNUP_COMMUNITY_TYPES)[number];

/**
 * True for every community the platform creates on the member's behalf —
 * General, city, sector, interest, experience-level and job-title communities.
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
 * - Platform default group (General, city, sector, experience level, job
 *   title) — the seal alone. The earth would only repeat what the seal already
 *   implies, and these groups are not something a member goes looking for.
 * - Interest community — the earth, because these are the public topic groups
 *   members browse. The seal is dropped so the earth reads as the group's own
 *   mark rather than a second, competing badge.
 * - Member-created — earth when public, lock when private.
 * - Private anything — the lock, next to the seal for a private default group.
 *
 * Unknown types fall through to "nothing but the lock when private" rather than
 * guessing a badge for a community kind the platform does not know yet.
 */
export function communityNameBadges(
  type: string | null | undefined,
  isPrivate: boolean | null | undefined,
): CommunityNameBadgeSpec {
  const signupCreated = isSignupCommunity(type);
  const isPrivateGroup = communityVisibility(isPrivate) === "private";

  if (type === INTEREST_COMMUNITY_TYPE) {
    return { verified: false, visibility: isPrivateGroup ? "lock" : "globe" };
  }

  if (isPrivateGroup) {
    return { verified: signupCreated, visibility: "lock" };
  }

  if (type === MEMBER_COMMUNITY_TYPE) {
    return { verified: false, visibility: "globe" };
  }

  return { verified: signupCreated, visibility: null };
}
