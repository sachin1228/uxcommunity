import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';
import {
  communityNameBadges,
  type CommunityVisibilityIcon as VisibilityKind,
} from '@/lib/communityBadges';

/**
 * The community badges, on mobile — a direct port of the web app's
 * `CommunityBadges.tsx`:

 *   ✓  verified seal — a default group the signup flow created for them
 *                      (city, sector, experience level, job title). It rides
 *                      the community's display picture, not its name.
 *   🌐 globe         — an open group: a public member-created community or
 *                      event room
 *   🔒 lock          — a closed group: any signup default group (joined only
 *                      through the signup match), or a private community
 *
 * Which badges a community gets is decided by `communityNameBadges` in
 * `lib/communityBadges.ts`; this file only draws them.
 */

/** Verified color — the universal blue of a verified seal (web parity). */
const VERIFIED_COLOR = '#1D9BF0';

/**
 * Verified seal for platform-created default groups. The glyph is the standard
 * 22×22 verified badge (a passport-stamp silhouette with a check cut out) —
 * the same path the web app draws, so both clients show the same mark.
 */
export function SignupCommunityBadge({ size = 13 }: { size?: number }) {
  return (
    <Svg
      viewBox="0 0 22 22"
      width={size}
      height={size}
      accessibilityRole="image"
      accessibilityLabel="Verified community"
    >
      <Path
        d="M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.239 1.266.296 1.903.164.636-.132 1.22-.447 1.68-.907.46-.46.776-1.044.908-1.681s.075-1.299-.165-1.903c.586-.274 1.084-.705 1.439-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z"
        fill={VERIFIED_COLOR}
      />
    </Svg>
  );
}

/** Globe for an open community, lock for a closed one. */
export function CommunityVisibilityIcon({
  kind,
  size = 12,
}: {
  kind: VisibilityKind;
  size?: number;
}) {
  const colors = useColors();
  const label = kind === 'lock' ? 'Private community' : 'Public community';
  return (
    <Feather
      name={kind === 'lock' ? 'lock' : 'globe'}
      size={size}
      strokeWidth={2.5}
      color={colors.mutedForeground}
      accessibilityLabel={label}
    />
  );
}

/**
 * The verified seal as it rides a community's display picture: pinned to the
 * face's bottom-right corner, ringed in the page colour so it reads on any
 * image. Draw it inside a positioned wrapper around the DP.
 */
export function VerifiedDpBadge({ dpSize }: { dpSize: number }) {
  const colors = useColors();
  return (
    <View
      pointerEvents="none"
      style={[styles.dpBadge, { backgroundColor: colors.background }]}
    >
      <SignupCommunityBadge size={dpSealSize(dpSize)} />
    </View>
  );
}

/** One proportion for every face; the floor keeps the smallest DP legible. */
function dpSealSize(dpSize: number): number {
  return Math.max(10, Math.round(dpSize / 3));
}

/**
 * The badges that sit beside a community name: "Name 🌐", "Name 🔒" or none.
 * Pass the community's `type` and `is_private` straight through — one
 * component so every surface draws the same pair from the same rules, and
 * renders nothing when the rules say a name carries no badge at all.
 */
export function CommunityNameBadges({
  type,
  isPrivate,
  size = 12,
}: {
  type?: string | null;
  isPrivate?: boolean | null;
  /** Icon size in px. */
  size?: number;
}) {
  const { visibility } = communityNameBadges(type, isPrivate);
  if (!visibility) return null;

  return (
    <View style={styles.row}>
      <CommunityVisibilityIcon kind={visibility} size={size} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  dpBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    borderRadius: 999,
    padding: 2,
  },
});
