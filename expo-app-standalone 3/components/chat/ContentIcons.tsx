import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

/**
 * The chat content-card glyphs — the exact lucide icons the web's
 * "created a …" cards draw (MessageCircle, Sparkles, FileText, CalendarDays,
 * ChevronRight, Users, Video, CircleHelp, Lightbulb, Flag, and the resource
 * tile set), ported as Svg so both clients show the same marks. Feather only
 * carries some of them and draws those differently, so the paths come
 * straight from the lucide sources — same 24×24 grid, same round 2.5px
 * strokes as the web cards and as components/community/TabIcons.tsx.
 */

export type ContentIconName =
  | 'message-circle'
  | 'sparkles'
  | 'file-text'
  | 'calendar-days'
  | 'chevron-right'
  | 'users'
  | 'video'
  | 'help-circle'
  | 'lightbulb'
  | 'flag'
  | 'figma'
  | 'wrench'
  | 'play'
  | 'book-open'
  | 'type'
  | 'shapes'
  | 'palette'
  | 'layout-template'
  | 'package';

interface Props {
  name: ContentIconName;
  size: number;
  color: string;
  strokeWidth?: number;
}

function IconBody({
  size,
  color,
  strokeWidth,
  children,
}: {
  size: number;
  color: string;
  strokeWidth?: number;
  children: React.ReactNode;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth ?? 2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  );
}

export function ContentIcon({ name, size, color, strokeWidth }: Props) {
  switch (name) {
    case 'message-circle':
      return (
        <IconBody size={size} color={color} strokeWidth={strokeWidth}>
          <Path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
        </IconBody>
      );
    case 'sparkles':
      return (
        <IconBody size={size} color={color} strokeWidth={strokeWidth}>
          <Path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
          <Path d="M20 3v4" />
          <Path d="M22 5h-4" />
          <Path d="M4 17v2" />
          <Path d="M5 18H3" />
        </IconBody>
      );
    case 'file-text':
      return (
        <IconBody size={size} color={color} strokeWidth={strokeWidth}>
          <Path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
          <Path d="M14 2v4a2 2 0 0 0 2 2h4" />
          <Path d="M10 9H8" />
          <Path d="M16 13H8" />
          <Path d="M16 17H8" />
        </IconBody>
      );
    case 'calendar-days':
      return (
        <IconBody size={size} color={color} strokeWidth={strokeWidth}>
          <Path d="M8 2v4" />
          <Path d="M16 2v4" />
          <Rect x={3} y={4} width={18} height={18} rx={2} />
          <Path d="M3 10h18" />
          <Path d="M8 14h.01" />
          <Path d="M12 14h.01" />
          <Path d="M16 14h.01" />
          <Path d="M8 18h.01" />
          <Path d="M12 18h.01" />
          <Path d="M16 18h.01" />
        </IconBody>
      );
    case 'chevron-right':
      return (
        <IconBody size={size} color={color} strokeWidth={strokeWidth}>
          <Path d="m9 18 6-6-6-6" />
        </IconBody>
      );
    case 'users':
      return (
        <IconBody size={size} color={color} strokeWidth={strokeWidth}>
          <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <Circle cx={9} cy={7} r={4} />
          <Path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <Path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </IconBody>
      );
    case 'video':
      return (
        <IconBody size={size} color={color} strokeWidth={strokeWidth}>
          <Path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
          <Rect x={2} y={6} width={14} height={12} rx={2} />
        </IconBody>
      );
    case 'help-circle':
      return (
        <IconBody size={size} color={color} strokeWidth={strokeWidth}>
          <Circle cx={12} cy={12} r={10} />
          <Path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <Path d="M12 17h.01" />
        </IconBody>
      );
    case 'lightbulb':
      return (
        <IconBody size={size} color={color} strokeWidth={strokeWidth}>
          <Path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
          <Path d="M9 18h6" />
          <Path d="M10 22h4" />
        </IconBody>
      );
    case 'flag':
      return (
        <IconBody size={size} color={color} strokeWidth={strokeWidth}>
          <Path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
          <Path d="M4 22V15" />
        </IconBody>
      );
    case 'figma':
      return (
        <IconBody size={size} color={color} strokeWidth={strokeWidth}>
          <Path d="M5 5.5A3.5 3.5 0 0 1 8.5 2H12v7H8.5A3.5 3.5 0 0 1 5 5.5z" />
          <Path d="M12 2h3.5a3.5 3.5 0 1 1 0 7H12V2z" />
          <Path d="M12 12.5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 1 1-7 0z" />
          <Path d="M5 19.5A3.5 3.5 0 0 1 8.5 16H12v3.5a3.5 3.5 0 1 1-7 0z" />
          <Path d="M5 12.5A3.5 3.5 0 0 1 8.5 9H12v7H8.5A3.5 3.5 0 0 1 5 12.5z" />
        </IconBody>
      );
    case 'wrench':
      return (
        <IconBody size={size} color={color} strokeWidth={strokeWidth}>
          <Path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
        </IconBody>
      );
    case 'play':
      return (
        <IconBody size={size} color={color} strokeWidth={strokeWidth}>
          <Path d="M6 3l14 9-14 9z" />
        </IconBody>
      );
    case 'book-open':
      return (
        <IconBody size={size} color={color} strokeWidth={strokeWidth}>
          <Path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <Path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </IconBody>
      );
    case 'type':
      return (
        <IconBody size={size} color={color} strokeWidth={strokeWidth}>
          <Path d="M4 7V4h16v3" />
          <Path d="M9 20h6" />
          <Path d="M12 4v16" />
        </IconBody>
      );
    case 'shapes':
      return (
        <IconBody size={size} color={color} strokeWidth={strokeWidth}>
          <Path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z" />
          <Rect x={3} y={14} width={7} height={7} rx={1} />
          <Circle cx={17.5} cy={17.5} r={3.5} />
        </IconBody>
      );
    case 'palette':
      return (
        <IconBody size={size} color={color} strokeWidth={strokeWidth}>
          <Circle cx={13.5} cy={6.5} r={0.5} fill={color} />
          <Circle cx={17.5} cy={10.5} r={0.5} fill={color} />
          <Circle cx={8.5} cy={7.5} r={0.5} fill={color} />
          <Circle cx={6.5} cy={12.5} r={0.5} fill={color} />
          <Path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
        </IconBody>
      );
    case 'layout-template':
      return (
        <IconBody size={size} color={color} strokeWidth={strokeWidth}>
          <Rect x={3} y={3} width={18} height={7} rx={1} />
          <Rect x={3} y={14} width={9} height={7} rx={1} />
          <Rect x={16} y={14} width={5} height={7} rx={1} />
        </IconBody>
      );
    case 'package':
      return (
        <IconBody size={size} color={color} strokeWidth={strokeWidth}>
          <Path d="m7.5 4.27 9 5.15" />
          <Path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
          <Path d="m3.3 7 8.7 5 8.7-5" />
          <Path d="M12 22V12" />
        </IconBody>
      );
  }
}
