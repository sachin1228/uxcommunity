import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Path, Pattern, Rect } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';

/**
 * Community chat wallpaper — a React Native port of the web's
 * `apps/web/public/doodles/designer-doodle.svg` (the masked `.chat-doodle-layer`
 * behind the community chat messages on web).
 *
 * Same 480-unit tile, same 24 designer motifs (pen nib, bezier handles,
 * artboard, palette, type, layers, flow, …) scattered across the same 49
 * placements, so both clients read as one wallpaper. The web version recolors
 * the artwork through a CSS mask; here the same ink is drawn directly and the
 * whole pattern rect is faded to the web's alpha per theme.
 */

const TILE = 480;
const INK_DARK_ALPHA = 0.045; // web `--chat-doodle-ink` (dark)
const INK_LIGHT_ALPHA = 0.05; // web `--chat-doodle-ink` (light)

const ICONS = {
  pen: (
    <>
      <Path d="M0 14 L-8 -6 L-8 -10 L8 -10 L8 -6 Z" />
      <Circle cx={0} cy={-3.5} r={2.6} />
      <Path d="M0 -0.9 L0 13" />
    </>
  ),
  bezier: (
    <>
      <Path d="M-17 8 C-9 -14 9 22 17 -6" />
      <Path d="M-17 8 L-9 -14" />
      <Path d="M17 -6 L9 22" />
      <Circle cx={-9} cy={-14} r={2.2} />
      <Circle cx={9} cy={22} r={2.2} />
      <Rect x={-19.5} y={5.5} width={5} height={5} />
      <Rect x={14.5} y={-8.5} width={5} height={5} />
    </>
  ),
  artboard: (
    <>
      <Rect x={-13} y={-15} width={26} height={30} rx={1.5} />
      <Path d="M-13 -19 V-15 M-17 -15 H-13 M13 -19 V-15 M13 -15 H17 M-13 15 V19 M-17 15 H-13 M13 15 V19 M13 15 H17" />
    </>
  ),
  palette: (
    <>
      <Circle cx={0} cy={0} r={12} />
      <Circle cx={4.5} cy={4.5} r={3} />
      <Circle cx={-5.5} cy={-4.5} r={1.7} />
      <Circle cx={0.5} cy={-7} r={1.7} />
      <Circle cx={6} cy={-2.5} r={1.7} />
    </>
  ),
  brush: (
    <>
      <Path d="M-13 -13 L0 0" />
      <Path d="M0 0 L4 4" strokeWidth={4} />
      <Path d="M4 4 C6.5 4.5 10 8 12.5 12.5 C14 15 11.5 16.5 9.8 14.8 C6 12 4.5 8 4 4 Z" />
    </>
  ),
  pencil: (
    <>
      <Path d="M-11 11 L5 -5 L9 -1 L-7 15 Z" />
      <Path d="M-11 11 L-15 15 L-7 15 Z" />
      <Path d="M3 -3 L7 1" />
    </>
  ),
  cursor: (
    <>
      <Path d="M0 0 L0 15 L4.5 11.2 L7.3 17.2 L10.3 15.7 L7.6 9.8 L13 9.4 Z" />
      <Path d="M0 -3.5 L0 -6.5" />
      <Path d="M-3.5 0 L-6.5 0" />
      <Path d="M-2.5 -2.5 L-5 -5" />
    </>
  ),
  dropper: (
    <>
      <Circle cx={8.5} cy={-8.5} r={3.2} />
      <Path d="M-2 2 L6 -6" />
      <Path d="M6 -6 L10 -2" />
      <Path d="M10 -2 L4 4" />
      <Path d="M-2 2 L-13 13 L4 4" />
    </>
  ),
  type: (
    <>
      <Path d="M-14 9 L-8 -9 L-2 9" />
      <Path d="M-11.5 3 L-4.5 3" />
      <Circle cx={6.5} cy={4} r={4.6} />
      <Path d="M11.1 -1 L11.1 9.5" />
    </>
  ),
  grid: (
    <>
      <Rect x={-13} y={-13} width={26} height={26} rx={2} />
      <Path d="M-13 -4 H13" />
      <Path d="M5 -13 V13" />
      <Rect x={2.5} y={-6.5} width={5} height={5} />
      <Rect x={2.5} y={2.5} width={5} height={5} />
    </>
  ),
  ruler: (
    <>
      <Rect x={-14} y={-5} width={28} height={10} rx={1} />
      <Path d="M-10 -5 V0 M-6 -5 V-1 M-2 -5 V0 M2 -5 V-1 M6 -5 V0 M10 -5 V-1" />
    </>
  ),
  layers: (
    <>
      <Path d="M-12 -10 L0 -15.5 L12 -10 L0 -4.5 Z" />
      <Path d="M-12 -1 L0 -6.5 L12 -1 L0 4.5 Z" />
      <Path d="M-12 8 L0 2.5 L12 8 L0 13.5 Z" />
    </>
  ),
  sticky: (
    <>
      <Path d="M-10 -12 H6 L12 -6 V10 C12 11.1 11.1 12 10 12 H-10 C-11.1 12 -12 11.1 -12 10 V-10 C-12 -11.1 -11.1 -12 -10 -12 Z" />
      <Path d="M6 -12 V-6 H12" />
      <Path d="M-6 -2 H6" />
      <Path d="M-6 3 H2" />
    </>
  ),
  bulb: (
    <>
      <Circle cx={0} cy={-4} r={7.5} />
      <Path d="M-3 3.2 V7 M3 3.2 V7" />
      <Path d="M-3 7 H3" />
      <Path d="M-2.2 9.5 H2.2" />
      <Path d="M0 -16 V-13.5" />
      <Path d="M-9.5 -12.5 L-7.8 -11" />
      <Path d="M9.5 -12.5 L7.8 -11" />
    </>
  ),
  smiley: (
    <>
      <Circle cx={0} cy={0} r={11} />
      <Path d="M-4 -3.5 V-2.5" />
      <Path d="M4 -3.5 V-2.5" />
      <Path d="M-4.5 3.5 C-2.5 6.8 2.5 6.8 4.5 3.5" />
    </>
  ),
  bubble: (
    <>
      <Path d="M-10 -8.5 H9 C10.7 -8.5 12 -7.2 12 -5.5 V4.5 C12 6.2 10.7 7.5 9 7.5 H-4.5 L-10 12.5 L-9.2 7.5 H-10 C-11.7 7.5 -13 6.2 -13 4.5 V-5.5 C-13 -7.2 -11.7 -8.5 -10 -8.5 Z" />
      <Path d="M-7.5 -0.5 V0.5 M-2.5 -0.5 V0.5 M2.5 -0.5 V0.5" />
    </>
  ),
  rocket: (
    <>
      <Path d="M0 -14 C5 -9 6.5 -2 4.5 6 H-4.5 C-6.5 -2 -5 -9 0 -14 Z" />
      <Circle cx={0} cy={-4} r={2.6} />
      <Path d="M-4.5 0.5 C-8.5 2.5 -9.5 5.5 -8.5 8.5 L-4.5 5" />
      <Path d="M4.5 0.5 C8.5 2.5 9.5 5.5 8.5 8.5 L4.5 5" />
      <Path d="M0 8.5 C-2 10.5 2 12 0 14.5" />
    </>
  ),
  heart: (
    <Path d="M0 10.5 C-2.5 10.5 -9 6 -11.5 0.5 C-13.5 -4 -10.5 -9.5 -6 -9.5 C-3 -9.5 -1 -7.5 0 -5.5 C1 -7.5 3 -9.5 6 -9.5 C10.5 -9.5 13.5 -4 11.5 0.5 C9 6 2.5 10.5 0 10.5 Z" />
  ),
  sparkle: (
    <Path d="M0 -12 C0.8 -4.5 4.5 -0.8 12 0 C4.5 0.8 0.8 4.5 0 12 C-0.8 4.5 -4.5 0.8 -12 0 C-4.5 -0.8 -0.8 -4.5 0 -12 Z" />
  ),
  component: (
    <>
      <Path d="M0 -11 L11 0 L0 11 L-11 0 Z" />
      <Circle cx={0} cy={-14.8} r={1.6} />
      <Circle cx={14.8} cy={0} r={1.6} />
      <Circle cx={0} cy={14.8} r={1.6} />
      <Circle cx={-14.8} cy={0} r={1.6} />
    </>
  ),
  gradient: (
    <>
      <Rect x={-13} y={-7} width={26} height={14} rx={3} />
      <Path d="M-8 3.5 L8 -3.5" />
      <Circle cx={-17} cy={0} r={2.4} />
      <Circle cx={17} cy={0} r={2.4} />
    </>
  ),
  wireframe: (
    <>
      <Rect x={-8} y={-13} width={16} height={26} rx={3} />
      <Path d="M-8 -6 H8" />
      <Path d="M-4.5 0 H4.5" />
      <Path d="M-4.5 4 H1" />
      <Path d="M-3 9.5 H3" />
    </>
  ),
  flow: (
    <>
      <Circle cx={-10} cy={-6.5} r={2.6} />
      <Circle cx={10.5} cy={6} r={2.6} />
      <Path d="M-7.2 -6.8 C0 -9.5 3.5 -1 7 3.8" />
      <Path d="M7 3.8 L4.2 2.8" />
      <Path d="M7 3.8 L6.2 0.8" />
    </>
  ),
  eye: (
    <>
      <Path d="M-13 0 C-7 -9 7 -9 13 0 C7 9 -7 9 -13 0 Z" />
      <Circle cx={0} cy={0} r={3.4} />
    </>
  ),
} as const;

type DoodleIcon = keyof typeof ICONS;

// Same 49 placements as the web tile: [icon, x, y, rotation].
const PLACEMENTS: readonly (readonly [DoodleIcon, number, number, number])[] = [
  ['pen', 34, 42, -8],
  ['bubble', 103, 32, 10],
  ['artboard', 171, 46, 6],
  ['smiley', 240, 34, -10],
  ['pencil', 309, 44, 12],
  ['palette', 377, 30, -6],
  ['bulb', 446, 48, 8],
  ['bezier', 68, 110, 10],
  ['rocket', 137, 98, -12],
  ['gradient', 205, 108, 8],
  ['sticky', 274, 100, -6],
  ['eye', 343, 112, 10],
  ['ruler', 411, 102, -10],
  ['sparkle', 16, 106, 8],
  ['layers', 34, 180, -8],
  ['cursor', 103, 168, 12],
  ['flow', 171, 180, -10],
  ['heart', 240, 166, 8],
  ['component', 309, 180, -12],
  ['brush', 377, 170, 10],
  ['wireframe', 446, 180, -8],
  ['palette', 68, 242, 10],
  ['pen', 137, 250, -6],
  ['type', 205, 244, -12],
  ['grid', 274, 248, 6],
  ['brush', 343, 240, 10],
  ['sticky', 411, 252, -8],
  ['smiley', 16, 244, -8],
  ['eye', 34, 308, -10],
  ['layers', 103, 316, 8],
  ['bulb', 171, 306, 12],
  ['component', 240, 314, -6],
  ['ruler', 309, 308, 10],
  ['artboard', 377, 318, -12],
  ['bubble', 446, 306, 8],
  ['pencil', 68, 386, 10],
  ['heart', 137, 378, -8],
  ['bezier', 205, 388, -12],
  ['cursor', 274, 380, 6],
  ['wireframe', 343, 388, -10],
  ['dropper', 411, 380, -6],
  ['bulb', 16, 382, 6],
  ['grid', 34, 446, 8],
  ['sparkle', 103, 452, -10],
  ['rocket', 171, 446, 12],
  ['pen', 240, 452, 10],
  ['flow', 309, 446, -12],
  ['gradient', 377, 452, 8],
  ['type', 446, 446, -8],
];

export function ChatDoodleWallpaper() {
  const colors = useColors();
  const isDark = colors.isDark;
  const ink = isDark ? '#FFFFFF' : '#09090B';

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg style={StyleSheet.absoluteFill}>
        <Defs>
          <Pattern
            id="chat-doodle-wallpaper"
            width={TILE}
            height={TILE}
            patternUnits="userSpaceOnUse"
          >
            {PLACEMENTS.map(([icon, x, y, rotation], index) => (
              <G
                key={index}
                transform={`translate(${x} ${y}) rotate(${rotation})`}
                stroke={ink}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              >
                {ICONS[icon]}
              </G>
            ))}
          </Pattern>
        </Defs>
        <Rect
          x={0}
          y={0}
          width="100%"
          height="100%"
          fill="url(#chat-doodle-wallpaper)"
          opacity={isDark ? INK_DARK_ALPHA : INK_LIGHT_ALPHA}
        />
      </Svg>
    </View>
  );
}
