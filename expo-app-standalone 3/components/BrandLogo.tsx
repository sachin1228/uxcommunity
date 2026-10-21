import React from 'react';
import Svg, { Path } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';

interface BrandLogoProps {
  size?: number;
}

/**
 * The brand speech-bubble mark, drawn bare — no tile behind it — in the
 * theme's foreground colour so it sits flush with the wordmark on every
 * screen.
 */
export function BrandLogo({ size = 56 }: BrandLogoProps) {
  const colors = useColors();

  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M14.666 7C14.666 3.667 11.999 2 7.999 2C3.999 2 1.332 3.667 1.332 7C1.332 10.333 3.999 12 7.999 12V14C7.999 14 14.666 12 14.666 7Z M4.583 7a.75.75 0 1 0 1.5 0a.75.75 0 1 0-1.5 0Z M7.25 7a.75.75 0 1 0 1.5 0a.75.75 0 1 0-1.5 0Z M9.917 7a.75.75 0 1 0 1.5 0a.75.75 0 1 0-1.5 0Z"
        fill={colors.foreground}
        fillRule="evenodd"
        clipRule="evenodd"
        transform="translate(-0.8 -0.8) scale(1.1)"
      />
    </Svg>
  );
}
