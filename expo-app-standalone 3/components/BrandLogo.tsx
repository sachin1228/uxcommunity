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
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M16 4H8a7 7 0 000 14h4v4l8.16-5.39A6.78 6.78 0 0023 11a7 7 0 00-7-7zm-8 8.25A1.25 1.25 0 119.25 11 1.25 1.25 0 018 12.25zm4 0A1.25 1.25 0 1113.25 11 1.25 1.25 0 0112 12.25zm4 0A1.25 1.25 0 1117.25 11 1.25 1.25 0 0116 12.25z"
        fill={colors.foreground}
      />
    </Svg>
  );
}
