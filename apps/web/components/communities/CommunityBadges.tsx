import { CheckmarkCircleFilled } from "@fluentui/react-icons/headless/svg/checkmark-circle";
import { GlobeRegular } from "@fluentui/react-icons/headless/svg/globe";
import { LockClosedRegular } from "@fluentui/react-icons/headless/svg/lock-closed";
import {
  communityNameBadges,
  type CommunityVisibilityIcon,
} from "@/lib/communities/community-badges";

/**
 * The badges shown after a community name, so a member can tell at a glance
 * what kind of group they are looking at:
 *
 *   ✓  verified seal — a default group the signup flow created for them
 *                      (General, city, sector, experience level, job title)
 *   🌐 earth         — an interest community, or a public member-created group
 *   🔒 lock          — a private group
 *
 * Which pair a community gets is decided by `communityNameBadges` in
 * `lib/communities/community-badges.ts`; this file only draws it.
 *
 * Both badges are labels rather than decoration: each carries an aria-label so
 * it is announced, and a title so the meaning is available on hover.
 */

/** Verified color — the universal blue of a verified seal. */
const VERIFIED_COLOR = "text-[#1D9BF0]";

/**
 * Verified seal for platform-created default groups. Backed by the Fluent 2
 * filled check-circle, so it scales cleanly from an 11px sidebar row to a
 * 16px invite page.
 */
export function SignupCommunityBadge({
  size = 13,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <CheckmarkCircleFilled
      fontSize={size}
      role="img"
      aria-label="Verified community"
      className={`shrink-0 ${VERIFIED_COLOR} ${className}`}
    />
  );
}

/** Earth for a public/discoverable community, lock for a private one. */
export function CommunityVisibilityIcon({
  kind,
  size = 12,
  className = "",
}: {
  kind: CommunityVisibilityIcon;
  size?: number;
  className?: string;
}) {
  const label = kind === "lock" ? "Private community" : "Public community";
  const Icon = kind === "lock" ? LockClosedRegular : GlobeRegular;

  return (
    // The label lives on the wrapper so the answer to "public or private?" is
    // announced once, and stays available on hover via the title.
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center text-foreground-muted ${className}`}
    >
      <Icon fontSize={size} aria-hidden="true" />
    </span>
  );
}

/**
 * The full badge pair for a community name: "Name ✓", "Name 🌐", "Name 🔒" or
 * "Name ✓ 🔒". Pass the community's `type` and `is_private` straight through —
 * one component so every surface draws the same pair from the same rules, and
 * renders nothing when the rules say a name carries no badge at all.
 */
export function CommunityNameBadges({
  type,
  isPrivate,
  size = 12,
  className = "",
}: {
  type?: string | null;
  isPrivate?: boolean | null;
  /** Icon size in px; the seal is drawn one px larger than the visibility icon. */
  size?: number;
  className?: string;
}) {
  const { verified, visibility } = communityNameBadges(type, isPrivate);
  if (!verified && !visibility) return null;

  return (
    <span className={`inline-flex shrink-0 items-center gap-1 ${className}`}>
      {verified ? <SignupCommunityBadge size={size + 1} /> : null}
      {visibility ? <CommunityVisibilityIcon kind={visibility} size={size} /> : null}
    </span>
  );
}
