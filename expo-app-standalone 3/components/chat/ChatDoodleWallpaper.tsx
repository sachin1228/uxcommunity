import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Path, Pattern, Rect } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';

/**
 * Community chat wallpaper — a React Native port of the web's
 * `apps/web/public/doodles/designer-doodle.svg` (the masked `.chat-doodle-layer`
 * behind the community chat messages on web).
 *
 * Same 480-unit tile, same 35 designer motifs (pen nib, bezier handles,
 * artboard, palette, type, layers, flow, plus organic fillers — sprig,
 * spiral, squiggle, hatch, …) across the same 132 placements (size tiers +
 * edge-wrap copies), so both clients read as one wallpaper. The web version recolors
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
  squiggle: <Path d="M-16 1 C-13 -7 -8 -7 -5 0 C-2 7 3 7 6 0 C8 -4 12 -4 15 0" />,
  spiral: (
    <Path d="M0 -13 C7.2 -13 13 -7.2 13 0 C13 7.2 7.2 13 0 13 C-7.2 13 -13 7.2 -13 0 C-13 -5 -9 -8 -5 -7 C-2 -6.3 -1 -4 -2.5 -2.2" />
  ),
  dots: (
    <>
      <Circle cx={-7} cy={-7} r={1.3} />
      <Circle cx={0} cy={-7} r={1.3} />
      <Circle cx={7} cy={-7} r={1.3} />
      <Circle cx={-7} cy={0} r={1.3} />
      <Circle cx={0} cy={0} r={1.3} />
      <Circle cx={7} cy={0} r={1.3} />
      <Circle cx={-7} cy={7} r={1.3} />
      <Circle cx={0} cy={7} r={1.3} />
      <Circle cx={7} cy={7} r={1.3} />
    </>
  ),
  hatch: (
    <Path d="M-11 -12 L-19 12 M-6 -12 L-14 12 M-1 -12 L-9 12 M4 -12 L-4 12 M9 -12 L1 12 M14 -12 L6 12" />
  ),
  sprig: (
    <>
      <Path d="M0 13 C1 7 1 0 0 -7" />
      <Path d="M0 -7 C-6 -10 -10 -14 -11 -19 C-5 -18 -1 -13 0 -7 Z" />
      <Path d="M0 -1 C6 -2 10 -5 12 -10 C7 -10 2 -6 0 -1 Z" />
    </>
  ),
  loops: (
    <Path d="M-14 5 C-14 -3 -8 -7 -5 -3 C-2 1 -6 5 -8 2 C-10 -1 -6 -5 -1 -5 C5 -5 8 1 14 4" />
  ),
  asterisk: (
    <>
      <Path d="M0 -10 L0 10" />
      <Path d="M-8.7 -5 L8.7 5" />
      <Path d="M-8.7 5 L8.7 -5" />
    </>
  ),
  plus: (
    <>
      <Path d="M0 -8 L0 8" />
      <Path d="M-8 0 L8 0" />
    </>
  ),
  drop: (
    <Path d="M0 -11 C4 -5 8 0 8 5 C8 10 4 13 0 13 C-4 13 -8 10 -8 5 C-8 0 -4 -5 0 -11 Z" />
  ),
  blob: (
    <Path d="M-10 -4 C-11 -9 -6 -12 -1 -11 C4 -10.5 10 -8 11 -3 C12 2 8 8 2 10 C-4 12 -9 7 -10 -4 Z" />
  ),
  bolt: <Path d="M2 -13 L-6 1 L-1 1 L-3 13 L7 -2 L1 -2 Z" />,
} as const;

type DoodleIcon = keyof typeof ICONS;

// Same placements as the web tile (118 scattered + 14 edge-wrap copies so
// the packed layout stays seamless when the 480 tile repeats).
const PLACEMENTS: readonly (readonly [DoodleIcon, number, number, number, number])[] = [
  ['pen', 95, 413, -8, 1.10],
  ['bubble', 184, 60, 19, 0.68],
  ['loops', 251, 198, -11, 1.14],
  ['sprig', 213, 280, -5, 1.43],
  ['type', 372, 265, -12, 1.06],
  ['cursor', 407, 455, -8, 1.01],
  ['cursor', 166, 176, 1, 1.14],
  ['wireframe', 410, 272, 21, 1.45],
  ['drop', 400, 164, 13, 1.70],
  ['loops', 58, 188, 14, 1.16],
  ['blob', 337, 21, 9, 1.12],
  ['hatch', 246, 79, 17, 1.41],
  ['eye', 267, 110, 7, 0.86],
  ['loops', 217, 439, -1, 1.47],
  ['layers', 87, 57, 18, 0.98],
  ['squiggle', 88, 360, -22, 0.77],
  ['ruler', 425, 206, -13, 0.58],
  ['brush', 143, 243, -17, 0.75],
  ['rocket', 114, 204, -18, 0.92],
  ['ruler', 198, 378, 21, 1.56],
  ['pen', 219, 469, -15, 0.61],
  ['smiley', 247, 460, -6, 1.49],
  ['asterisk', 215, 47, 4, 0.76],
  ['smiley', 314, 417, -21, 1.03],
  ['rocket', 32, 235, -9, 0.98],
  ['plus', 465, 342, 8, 0.87],
  ['artboard', 67, 278, 0, 1.43],
  ['hatch', 395, 414, 7, 1.62],
  ['smiley', 281, 176, -14, 1.13],
  ['ruler', 330, 350, -19, 0.68],
  ['bulb', 269, 383, 5, 1.70],
  ['bulb', 154, 24, 0, 1.18],
  ['smiley', 161, 263, -0, 1.20],
  ['cursor', 314, 311, -7, 1.01],
  ['pen', 166, 377, 2, 0.95],
  ['dots', 348, 338, 3, 0.56],
  ['grid', 64, 323, -1, 1.35],
  ['component', 405, 362, -1, 1.75],
  ['wireframe', 339, 230, 7, 0.92],
  ['dropper', 136, 466, -14, 1.04],
  ['bolt', 449, 316, -1, 0.75],
  ['squiggle', 250, 241, -4, 0.98],
  ['smiley', 207, 73, 15, 0.63],
  ['squiggle', 281, 440, 8, 1.64],
  ['pencil', 20, 312, 11, 1.07],
  ['sticky', 315, 223, 19, 0.95],
  ['flow', 466, 65, 1, 1.59],
  ['smiley', 213, 213, 3, 0.71],
  ['asterisk', 430, 111, -2, 0.60],
  ['sparkle', 192, 151, -12, 0.73],
  ['artboard', 396, 116, 20, 1.37],
  ['hatch', 76, 11, 17, 1.62],
  ['drop', 36, 397, 10, 0.68],
  ['smiley', 322, 116, -9, 0.77],
  ['smiley', 225, 368, -21, 0.72],
  ['sticky', 54, 446, 16, 1.04],
  ['eye', 12, 13, 15, 1.11],
  ['sticky', 453, 118, -10, 0.70],
  ['eye', 290, 208, 21, 0.71],
  ['dots', 121, 157, -22, 1.11],
  ['plus', 127, 320, 10, 0.99],
  ['sparkle', 94, 443, 19, 0.63],
  ['drop', 444, 290, -9, 0.96],
  ['cursor', 182, 211, 1, 0.57],
  ['bolt', 108, 451, 9, 0.70],
  ['loops', 13, 121, -2, 0.99],
  ['component', 334, 156, -2, 0.67],
  ['pen', 357, 382, -7, 1.00],
  ['bezier', 452, 388, 17, 1.48],
  ['smiley', 204, 186, -15, 1.00],
  ['smiley', 280, 218, -16, 0.57],
  ['asterisk', 293, 128, -11, 1.06],
  ['dropper', 231, 119, -6, 1.18],
  ['type', 314, 98, -18, 0.88],
  ['asterisk', 356, 11, -17, 0.78],
  ['artboard', 91, 95, -18, 1.17],
  ['dots', 444, 260, -13, 0.73],
  ['eye', 391, 39, -15, 1.53],
  ['bolt', 243, 303, -22, 0.68],
  ['drop', 111, 296, 4, 0.77],
  ['drop', 273, 301, 8, 0.69],
  ['hatch', 85, 153, 4, 0.88],
  ['bubble', 374, 451, -10, 0.96],
  ['bubble', 136, 361, -12, 1.68],
  ['dropper', 335, 252, 4, 0.67],
  ['type', 263, 261, -9, 0.70],
  ['plus', 19, 70, -1, 0.64],
  ['wireframe', 144, 78, -9, 0.93],
  ['plus', 274, 47, -5, 0.87],
  ['heart', 404, 75, 0, 0.58],
  ['palette', 401, 201, -3, 1.01],
  ['plus', 45, 380, -16, 0.98],
  ['asterisk', 14, 451, -2, 0.94],
  ['dots', 229, 22, -13, 0.59],
  ['cursor', 441, 448, 3, 1.15],
  ['squiggle', 297, 273, -4, 1.13],
  ['gradient', 30, 91, 0, 1.03],
  ['component', 90, 384, -17, 0.86],
  ['type', 108, 242, -11, 0.73],
  ['sparkle', 313, 11, -5, 1.08],
  ['smiley', 148, 302, -3, 0.64],
  ['bubble', 350, 89, 9, 1.03],
  ['drop', 449, 173, 7, 0.61],
  ['heart', 160, 120, 16, 0.66],
  ['heart', 141, 175, 6, 0.77],
  ['drop', 11, 235, -7, 0.77],
  ['loops', 312, 197, -6, 0.56],
  ['brush', 470, 234, 19, 1.10],
  ['component', 224, 328, -22, 1.05],
  ['bolt', 366, 173, 6, 0.65],
  ['dots', 26, 188, -10, 0.61],
  ['blob', 344, 49, 10, 1.39],
  ['bubble', 327, 279, 2, 0.87],
  ['wireframe', 71, 232, -5, 1.55],
  ['asterisk', 60, 110, -13, 1.14],
  ['wireframe', 205, 106, -12, 0.97],
  ['smiley', 86, 184, -0, 0.60],
  ['asterisk', 335, 131, -19, 0.59],
  ['pen', 219, -11, -15, 0.61],
  ['dropper', 136, -14, -14, 1.04],
  ['pencil', 500, 312, 11, 1.07],
  ['flow', -14, 65, 1, 1.59],
  ['hatch', 76, 491, 17, 1.62],
  ['eye', 492, 13, 15, 1.11],
  ['eye', 12, 493, 15, 1.11],
  ['eye', 492, 493, 15, 1.11],
  ['loops', 493, 121, -2, 0.99],
  ['bezier', -28, 388, 17, 1.48],
  ['asterisk', 356, 491, -17, 0.78],
  ['sparkle', 313, 491, -5, 1.08],
  ['drop', 491, 235, -7, 0.77],
  ['brush', -10, 234, 19, 1.10],
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
            {PLACEMENTS.map(([icon, x, y, rotation, scale], index) => (
              <G
                key={index}
                transform={`translate(${x} ${y}) rotate(${rotation}) scale(${scale})`}
                stroke={ink}
                strokeWidth={2 / scale}
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
