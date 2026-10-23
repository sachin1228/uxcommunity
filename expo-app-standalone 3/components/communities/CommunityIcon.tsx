import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';

/**
 * The no-picture community face — a direct port of the web app's
 * `CommunityIcon`: a ringed circle carrying lucide's ImagePlus glyph, the
 * "add a picture here" empty slot. Every surface that draws a community DP
 * falls back to this, so a community without an image looks the same in the
 * chat list, Explore, the preview sheet, the chat header, the info hero and
 * the feed's "posted in" chip.
 *
 * The ring lives only on the fallback: a community WITH an image keeps the
 * plain circle.
 */
export function CommunityIcon({
  size = 40,
  iconSize,
}: {
  /** Container diameter in dp (a square circle). */
  size?: number;
  /** Glyph size in dp — defaults to half the container, like the web. */
  iconSize?: number;
}) {
  const colors = useColors();
  const glyph = iconSize ?? Math.round(size * 0.5);
  const stroke = colors.foregroundMuted;

  return (
    <View
      style={[
        styles.frame,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: colors.border,
          backgroundColor: colors.background,
        },
      ]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={glyph} height={glyph} viewBox="0 0 24 24" fill="none">
        {/* lucide ImagePlus, stroke 2.5 — the web `CommunityIcon` glyph. */}
        <Path
          d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7"
          stroke={stroke}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path d="M16 5h6" stroke={stroke} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        <Path d="M19 2v6" stroke={stroke} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        <Circle cx={9} cy={9} r={2} stroke={stroke} strokeWidth={2.5} />
        <Path
          d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"
          stroke={stroke}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
