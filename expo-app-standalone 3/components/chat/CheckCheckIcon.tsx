import React from 'react';
import Svg, { Path } from 'react-native-svg';

/**
 * The sent indicator on own messages: the web bubble's double check (lucide
 * `CheckCheck`), drawn from the same paths so both clients show the same
 * mark. Ionicons' `checkmark-done-sharp` — what mobile used to draw — is a
 * different, filled glyph; this keeps the web's thin round-capped strokes.
 */
export function CheckCheckIcon({
  size = 12,
  color,
  opacity,
}: {
  size?: number;
  color: string;
  opacity?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={opacity}
    >
      <Path d="M18 6 7 17l-5-5" />
      <Path d="m22 10-7.5 7.5L13 16" />
    </Svg>
  );
}
