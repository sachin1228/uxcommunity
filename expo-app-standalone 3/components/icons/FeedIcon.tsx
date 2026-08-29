import React from 'react';
import Svg, { Path, Circle } from 'react-native-svg';

interface FeedIconProps {
  size?: number;
  color?: string;
}

export function FeedIcon({ size = 20, color = 'currentColor' }: FeedIconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 20 20" fill="none">
      <Path
        d="M3 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z"
        stroke={color}
        strokeWidth="1.5"
        fill="none"
      />
      <Circle cx="6.5" cy="14.5" r="1.5" fill={color} />
      <Path
        d="M6.5 8.5a6 6 0 0 1 6 6"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
      <Path
        d="M6.5 11.5a3 3 0 0 1 3 3"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </Svg>
  );
}
