import React from 'react';
import Svg, {
  ClipPath,
  Defs,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

interface BrandLogoProps {
  size?: number;
}

export function BrandLogo({ size = 56 }: BrandLogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <Defs>
        <LinearGradient id="uxc-bg" x1="128" y1="0" x2="128" y2="256" gradientUnits="userSpaceOnUse">
          <Stop offset="0%" stopColor="#30323A" />
          <Stop offset="38%" stopColor="#24262D" />
          <Stop offset="100%" stopColor="#1D1F26" />
        </LinearGradient>

        <RadialGradient
          id="uxc-gloss"
          cx="0"
          cy="0"
          r="1"
          gradientUnits="userSpaceOnUse"
          gradientTransform="translate(105 15) rotate(70) scale(210 180)"
        >
          <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.12} />
          <Stop offset="45%" stopColor="#FFFFFF" stopOpacity={0.035} />
          <Stop offset="100%" stopColor="#FFFFFF" stopOpacity={0} />
        </RadialGradient>

        <LinearGradient id="uxc-depth" x1="128" y1="110" x2="128" y2="256" gradientUnits="userSpaceOnUse">
          <Stop offset="0%" stopColor="#000000" stopOpacity={0} />
          <Stop offset="100%" stopColor="#000000" stopOpacity={0.16} />
        </LinearGradient>

        <ClipPath id="uxc-clip">
          <Path d="M128 2 C77 2 44 8 25 26 C7 44 2 77 2 128 C2 179 7 212 26 230 C45 249 78 254 128 254 C178 254 211 249 230 230 C249 211 254 178 254 128 C254 77 249 44 230 26 C211 8 178 2 128 2Z" />
        </ClipPath>
      </Defs>

      <G clipPath="url(#uxc-clip)">
        <Rect width="256" height="256" fill="url(#uxc-bg)" />
        <Rect width="256" height="256" fill="url(#uxc-gloss)" />
        <Rect width="256" height="256" fill="url(#uxc-depth)" />
      </G>

      <G transform="translate(49 49) scale(6.6)">
        <Path
          d="M16 4H8a7 7 0 0 0 0 14h4v4l8.16-5.39A6.78 6.78 0 0 0 23 11a7 7 0 0 0-7-7 M8 12.25A1.25 1.25 0 1 1 9.25 11 1.25 1.25 0 0 1 8 12.25 m4 0A1.25 1.25 0 1 1 13.25 11 1.25 1.25 0 0 1 12 12.25 m4 0A1.25 1.25 0 1 1 17.25 11 1.25 1.25 0 0 1 16 12.25"
          fill="#FFFFFF"
        />
      </G>
    </Svg>
  );
}
