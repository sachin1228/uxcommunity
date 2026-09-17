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
 * These are the communities a member never created, so they carry the verified
 * seal — the same visual language social apps use for an official account.
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
