import React from 'react';
import Svg, {
  Defs,
  Filter,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
  FeDropShadow,
} from 'react-native-svg';

interface BrandLogoProps {
  size?: number;
}

export function BrandLogo({ size = 56 }: BrandLogoProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 256 256" fill="none">
      <Defs>
        <LinearGradient id="bg" x1="128" y1="0" x2="128" y2="256" gradientUnits="userSpaceOnUse">
          <Stop offset="0%" stopColor="#30323A" />
          <Stop offset="38%" stopColor="#24262D" />
          <Stop offset="100%" stopColor="#1D1F26" />
        </LinearGradient>

        <RadialGradient
          id="gloss"
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

        <LinearGradient id="bubble" x1="128" y1="47" x2="128" y2="181" gradientUnits="userSpaceOnUse">
          <Stop offset="0%" stopColor="#FFFFFF" />
          <Stop offset="72%" stopColor="#FCFCFC" />
          <Stop offset="100%" stopColor="#E8E9ED" />
        </LinearGradient>

        <Filter id="shadow" x="35" y="35" width="190" height="165" filterUnits="userSpaceOnUse">
          <FeDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#000000" floodOpacity={0.25} />
        </Filter>
      </Defs>

      <Rect x="0" y="0" width="256" height="256" fill="url(#bg)" />
      <Rect x="0" y="0" width="256" height="256" fill="url(#gloss)" />

      <Path
        d="M128 47 C85 47 52 70 52 106 C52 126 63 142 83 152 C84 162 81 170 75 177 C74 179 76 181 79 181 C93 180 104 174 111 167 C116 168 122 168 128 168 C171 168 204 145 204 106 C204 70 171 47 128 47Z"
        fill="url(#bubble)"
        filter="url(#shadow)"
      />
    </Svg>
  );
}
