import React from 'react';
import Svg, { Circle, Path } from 'react-native-svg';

/**
 * Direct messages — an outlined speech bubble with three dots, ported from
 * `apps/web/components/ui/DmIcon.tsx`.
 *
 * A stroked 24×24 glyph so it matches the rest of the icon set (Feather on
 * mobile, lucide on web) instead of a filled mark. Feather has no bubble with
 * dots, so the SVG is drawn directly (`react-native-svg` is already a
 * dependency).
 */
export function DmIcon({
  size = 16,
  color,
  strokeWidth = 2,
}: {
  size?: number;
  color: string;
  strokeWidth?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M16 4H8a7 7 0 0 0 0 14h4v4l8.16-5.39A6.78 6.78 0 0 0 23 11a7 7 0 0 0-7-7Z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={8} cy={11} r={1.25} fill={color} />
      <Circle cx={12} cy={11} r={1.25} fill={color} />
      <Circle cx={16} cy={11} r={1.25} fill={color} />
    </Svg>
  );
}
