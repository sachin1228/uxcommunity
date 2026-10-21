import React from 'react';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import type { CommunityTab } from '@/lib/communityContent';

/**
 * The community nav's tab glyphs — the exact lucide icons the web chat
 * header draws (MessageCircle, MessagesSquare, Image, Link2, Calendar),
 * ported as Svg so both clients show the same marks. Feather only carries
 * some of them (and draws those differently), so the paths come straight from
 * the lucide sources, on the same 24×24 grid with the same round 2.5px
 * strokes the web header uses.
 */

type IconProps = { size: number; color: string };

function IconBody({ size, color, children }: IconProps & { children: React.ReactNode }) {
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
    >
      {children}
    </Svg>
  );
}

export function CommunityTabIcon({
  tab,
  size = 14,
  color,
}: {
  tab: CommunityTab;
  size?: number;
  color: string;
}) {
  switch (tab) {
    case 'chat':
      return (
        <IconBody size={size} color={color}>
          <Path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        </IconBody>
      );
    case 'threads':
      return (
        <IconBody size={size} color={color}>
          <Path d="M14 9a2 2 0 0 1-2 2H6l-4 4V4c0-1.1.9-2 2-2h8a2 2 0 0 1 2 2z" />
          <Path d="M18 9h2a2 2 0 0 1 2 2v11l-4-4h-6a2 2 0 0 1-2-2v-1" />
        </IconBody>
      );
    case 'showcase':
      return (
        <IconBody size={size} color={color}>
          <Rect width={18} height={18} x={3} y={3} rx={2} ry={2} />
          <Circle cx={9} cy={9} r={2} />
          <Path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
        </IconBody>
      );
    case 'resources':
      return (
        <IconBody size={size} color={color}>
          <Path d="M9 17H7A5 5 0 0 1 7 7h2" />
          <Path d="M15 7h2a5 5 0 1 1 0 10h-2" />
          <Line x1={8} x2={16} y1={12} y2={12} />
        </IconBody>
      );
    case 'events':
      return (
        <IconBody size={size} color={color}>
          <Path d="M8 2v4" />
          <Path d="M16 2v4" />
          <Rect x="3" y="4" width="18" height="18" rx="2" />
          <Path d="M3 10h18" />
        </IconBody>
      );
  }
}
