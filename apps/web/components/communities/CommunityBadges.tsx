import { Globe2, Lock } from "lucide-react";
import { communityVisibility, isSignupCommunity } from "@/lib/communities/community-badges";

/**
 * The badge pair shown after every community name:
 *
 *   ✓ verified seal — the community was created for the member by the signup
 *                     flow (General, city, sector, interest, experience level,
 *                     job title) rather than by another member.
 *   globe / lock    — public communities advertise themselves with the earth
 *                     icon; a member-created private community shows a lock.
 *
 * Both are decorative-next-to-text: they carry an aria-label so they are still
 * announced, and a title so the meaning is available on hover.
 */

/** Verified color — the universal blue of a verified seal. */
const VERIFIED_COLOR = "text-[#1D9BF0]";

/**
 * Verified seal for platform-created communities. The glyph is the standard
 * 22×22 verified badge (a passport-stamp silhouette with a check cut out), so
 * it scales cleanly from an 11px sidebar row to a 16px settings header.
 */
export function SignupCommunityBadge({
  size = 13,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 22 22"
      width={size}
      height={size}
      role="img"
      aria-label="Verified community"
      focusable="false"
      className={`shrink-0 fill-current ${VERIFIED_COLOR} ${className}`}
    >
      <g>
        <path d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z" />
      </g>
    </svg>
  );
}

/** Earth for a public community, lock for one only its members can see. */
export function CommunityVisibilityBadge({
  isPrivate,
  size = 12,
  className = "",
}: {
  isPrivate?: boolean | null;
  size?: number;
  className?: string;
}) {
  const visibility = communityVisibility(isPrivate);
  const label = visibility === "private" ? "Private community" : "Public community";
  const Icon = visibility === "private" ? Lock : Globe2;

  return (
    // The label lives on the wrapper so the answer to "public or private?" is
    // announced once, and stays available on hover via the title.
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-flex shrink-0 items-center text-foreground-muted ${className}`}
    >
      <Icon strokeWidth={2.5} size={size} aria-hidden="true" />
    </span>
  );
}

/**
 * Both badges in the order they read: "Name ✓ 🌐". One component so a new
 * surface can't show a lock without the matching verified seal (or vice
 * versa) — pass the community's `type` and `is_private` straight through.
 */
export function CommunityNameBadges({
  type,
  isPrivate,
  size = 12,
  className = "",
}: {
  type?: string | null;
  isPrivate?: boolean | null;
  /** Icon size in px for the visibility glyph; the seal is drawn one px larger. */
  size?: number;
  className?: string;
}) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 ${className}`}>
      {isSignupCommunity(type) ? <SignupCommunityBadge size={size + 1} /> : null}
      <CommunityVisibilityBadge isPrivate={isPrivate} size={size} />
    </span>
  );
}
