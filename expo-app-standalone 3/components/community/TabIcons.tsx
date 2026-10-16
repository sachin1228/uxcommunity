import React from 'react';
import Svg, { Path, Polyline, Rect } from 'react-native-svg';
import type { CommunityTab } from '@/lib/communityContent';

/**
 * The community nav's tab glyphs — the exact lucide icons the web chat
 * header draws (MessageCircle, MessagesSquare, Sparkles, BookMarked,
 * Calendar), ported as Svg so both clients show the same marks. Feather only
 * carries some of them (and draws those differently), so the paths come
 * straight from the lucide sources, on the same 24×24 grid with the same
 * round 2.5px strokes the web header uses.
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
          <Path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
          <Path d="M20 3v4" />
          <Path d="M22 5h-4" />
          <Path d="M4 17v2" />
          <Path d="M5 18H3" />
        </IconBody>
      );
    case 'resources':
      return (
        <IconBody size={size} color={color}>
          <Path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
          <Polyline points="10 2 10 10 13 7 16 10 16 2" />
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
