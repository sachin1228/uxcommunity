import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Path, Pattern, Rect } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';

/**
 * Community chat wallpaper — a React Native port of the web's
 * `apps/web/public/doodles/designer-doodle.svg` (the masked `.chat-doodle-layer`
 * behind the community chat messages on web).
 *
 * Same 480-unit tile, same 59 designer motifs (pen nib, bezier handles,
 * artboard, palette, type, layers, flow, design-tool shapes — layered stack,
 * prototype play, frame marks, link, export — bubble variants — heart, ask,
 * typing, double, lines — plus organic fillers) across the same 207 placements
 * (size tiers + empty-spot fill + edge-wrap copies), so both clients read as one wallpaper. The web version recolors
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
  'figma-stack': (
    <>
      <Rect x={-7} y={-15} width={14} height={9} rx={4.5} />
      <Rect x={-7} y={-4.5} width={14} height={9} rx={2} />
      <Circle cx={-2.5} cy={9.5} r={4.5} />
      <Rect x={3} y={5} width={9} height={9} rx={2} />
    </>
  ),
  play: (
    <>
      <Circle cx={0} cy={0} r={11} />
      <Path d="M-3.5 -4.5 L5 0 L-3.5 4.5 Z" />
    </>
  ),
  export: (
    <>
      <Rect x={-9} y={-4} width={18} height={15} rx={2} />
      <Path d="M0 -13 V-2 M-4.5 -8.5 L0 -13 L4.5 -8.5" />
    </>
  ),
  frame: <Path d="M-6 -13 V13 M6 -13 V13 M-13 -6 H13 M-13 6 H13" />,
  align: (
    <>
      <Path d="M-10 -12 V12" />
      <Rect x={-5} y={-9} width={14} height={6} rx={3} />
      <Rect x={-5} y={3} width={9} height={6} rx={3} />
    </>
  ),
  text: <Path d="M-9 -9 H9 M0 -9 V11 M-4.5 11 H4.5" />,
  sliders: (
    <>
      <Path d="M-11 -7 H11 M-11 0 H11 M-11 7 H11" />
      <Circle cx={-3} cy={-7} r={2.6} />
      <Circle cx={5} cy={0} r={2.6} />
      <Circle cx={-6} cy={7} r={2.6} />
    </>
  ),
  image: (
    <>
      <Rect x={-12} y={-9} width={24} height={18} rx={2} />
      <Circle cx={-5} cy={-2.5} r={2.5} />
      <Path d="M-12 5 L-4 -2 L3 4 L8 -1 L12 3" />
    </>
  ),
  link: (
    <>
      <Rect x={-11.5} y={-3.5} width={12} height={7} rx={3.5} transform="rotate(-45)" />
      <Rect x={-0.5} y={-3.5} width={12} height={7} rx={3.5} transform="rotate(-45)" />
    </>
  ),
  'cloud-up': (
    <>
      <Path d="M-6 6 C-11 6 -13 2.5 -13 -0.5 C-13 -3.5 -10.5 -5.5 -7.5 -5.5 C-7 -9.5 -3.5 -12 0 -12 C4.5 -12 8 -8.5 8 -4.5 C11 -4.5 13 -2.5 13 0.5 C13 3.5 10.5 6 7.5 6 H-6 Z" />
      <Path d="M0 8 V-2 M-3.5 1.5 L0 -2 L3.5 1.5" />
    </>
  ),
  undo: (
    <>
      <Path d="M-10 8 C-10 -1 -3 -7 6 -7 H10" />
      <Path d="M6.5 -11 L10.5 -7 L6.5 -3" />
    </>
  ),
  infinity: (
    <>
      <Circle cx={-6} cy={0} r={6} />
      <Circle cx={6} cy={0} r={6} />
    </>
  ),
  mask: (
    <>
      <Rect x={-12} y={-12} width={24} height={24} rx={3} />
      <Circle cx={0} cy={0} r={8} strokeDasharray="3 3" />
    </>
  ),
  cmd: (
    <>
      <Rect x={-6} y={-6} width={12} height={12} />
      <Circle cx={-6} cy={-6} r={2.8} />
      <Circle cx={6} cy={-6} r={2.8} />
      <Circle cx={-6} cy={6} r={2.8} />
      <Circle cx={6} cy={6} r={2.8} />
    </>
  ),
  toggle: (
    <>
      <Rect x={-12} y={-6} width={24} height={12} rx={6} />
      <Circle cx={3} cy={0} r={3.5} />
    </>
  ),
  pin: (
    <>
      <Path d="M0 12 C-3 8 -8 3.5 -8 -2 C-8 -8 -4.5 -12 0 -12 C4.5 -12 8 -8 8 -2 C8 3.5 3 8 0 12 Z" />
      <Circle cx={0} cy={-3} r={3} />
    </>
  ),
  select: (
    <>
      <Rect x={-13} y={-13} width={20} height={20} strokeDasharray="3.5 3.5" />
      <Path d="M3 3 L10 8 L6 8.6 L8 12.5 L5.5 13.5 L3.6 9.8 L1 11.5 Z" />
    </>
  ),
  video: (
    <>
      <Rect x={-13} y={-8} width={26} height={16} rx={3} />
      <Path d="M-2.5 -3.5 L3.5 0 L-2.5 3.5 Z" />
    </>
  ),
  colorwheel: (
    <>
      <Circle cx={0} cy={0} r={10} />
      <Path d="M-10 0 H10 M-5 -8.66 L5 8.66 M-5 8.66 L5 -8.66" />
      <Circle cx={0} cy={0} r={1.5} />
    </>
  ),
  'bubble-heart': (
    <>
      <Path d="M-10 -8.5 H9 C10.7 -8.5 12 -7.2 12 -5.5 V4.5 C12 6.2 10.7 7.5 9 7.5 H-4.5 L-10 12.5 L-9.2 7.5 H-10 C-11.7 7.5 -13 6.2 -13 4.5 V-5.5 C-13 -7.2 -11.7 -8.5 -10 -8.5 Z" />
      <Path d="M-1 3.5 C-2 3.5 -4.5 2 -5.5 0 C-6.3 -1.7 -5.2 -3.5 -3.5 -3.5 C-2.4 -3.5 -1.4 -2.8 -1 -2.2 C-0.6 -2.8 0.4 -3.5 1.5 -3.5 C3.2 -3.5 4.3 -1.7 3.5 0 C2.5 2 0 3.5 -1 3.5 Z" />
    </>
  ),
  'bubble-ask': (
    <>
      <Path d="M-10 -8.5 H9 C10.7 -8.5 12 -7.2 12 -5.5 V4.5 C12 6.2 10.7 7.5 9 7.5 H-4.5 L-10 12.5 L-9.2 7.5 H-10 C-11.7 7.5 -13 6.2 -13 4.5 V-5.5 C-13 -7.2 -11.7 -8.5 -10 -8.5 Z" />
      <Path d="M-2.2 -3.6 C-2.2 -6 2.2 -6 2.2 -3.6 C2.2 -1.8 0 -2 0 -0.2" />
      <Path d="M0 2.4 V2.6" />
    </>
  ),
  'bubble-typing': (
    <>
      <Rect x={-12} y={-6} width={24} height={12} rx={6} />
      <Path d="M-6 0 V0.1 M0 0 V0.1 M6 0 V0.1" />
    </>
  ),
  'bubble-double': (
    <>
      <Rect x={-13} y={-11} width={17} height={11} rx={4} />
      <Rect x={-4} y={-2} width={18} height={11} rx={4} />
      <Path d="M-2 9 L-2 13 L3.5 9" />
    </>
  ),
  'bubble-lines': (
    <>
      <Path d="M-10 -8.5 H9 C10.7 -8.5 12 -7.2 12 -5.5 V4.5 C12 6.2 10.7 7.5 9 7.5 H-4.5 L-10 12.5 L-9.2 7.5 H-10 C-11.7 7.5 -13 6.2 -13 4.5 V-5.5 C-13 -7.2 -11.7 -8.5 -10 -8.5 Z" />
      <Path d="M-7 -3 H7 M-7 0.5 H3" />
    </>
  ),
} as const;

type DoodleIcon = keyof typeof ICONS;

// Same placements as the web tile (118 scattered + 14 edge-wrap copies so
// the packed layout stays seamless when the 480 tile repeats).
const PLACEMENTS: readonly (readonly [DoodleIcon, number, number, number, number])[] = [
  ['pen', 95, 413, -8, 0.88],
  ['dots', 184, 60, 19, 0.58],
  ['toggle', 251, 198, -11, 0.63],
  ['cmd', 213, 280, -5, 0.52],
  ['smiley', 372, 265, -12, 0.59],
  ['layers', 407, 455, -8, 0.83],
  ['ruler', 166, 176, 1, 0.91],
  ['play', 410, 272, 21, 0.78],
  ['bubble-ask', 400, 164, 13, 1.36],
  ['select', 58, 188, 14, 0.93],
  ['bubble-typing', 337, 21, 9, 0.90],
  ['undo', 246, 79, 17, 0.76],
  ['frame', 267, 110, 7, 0.73],
  ['toggle', 217, 439, -1, 0.79],
  ['component', 87, 57, 18, 0.81],
  ['text', 88, 360, -22, 0.65],
  ['heart', 425, 206, -13, 0.50],
  ['dropper', 143, 243, -17, 0.63],
  ['sprig', 114, 204, -18, 0.77],
  ['sparkle', 198, 378, 21, 1.23],
  ['bezier', 219, 469, -15, 0.78],
  ['spiral', 247, 460, -6, 1.17],
  ['video', 215, 47, 4, 0.65],
  ['squiggle', 314, 417, -21, 0.84],
  ['loops', 32, 235, -9, 0.81],
  ['bubble-heart', 465, 342, 8, 1.07],
  ['palette', 67, 278, 0, 1.12],
  ['mask', 395, 414, 7, 0.94],
  ['dots', 281, 176, -14, 0.91],
  ['heart', 330, 350, -19, 0.58],
  ['flow', 269, 383, 5, 1.35],
  ['eye', 154, 24, 0, 0.94],
  ['spiral', 161, 263, -0, 1.40],
  ['blob', 239, 289, 18, 0.58],
  ['cloud-up', 311, 164, -21, 0.87],
  ['undo', 348, 338, 3, 0.73],
  ['artboard', 437, 401, -12, 0.84],
  ['plus', 291, 129, 22, 0.62],
  ['bubble-lines', 362, 227, 5, 1.35],
  ['hatch', 230, 311, -12, 0.88],
  ['sparkle', 466, 96, -16, 0.53],
  ['grid', 284, 462, -15, 1.08],
  ['hatch', 207, 73, 15, 0.80],
  ['image', 298, 20, 7, 0.61],
  ['infinity', 147, 315, -2, 0.55],
  ['bubble-typing', 344, 378, -9, 0.57],
  ['text', 340, 422, 6, 0.92],
  ['align', 65, 249, -3, 0.95],
  ['bubble-ask', 420, 357, 16, 0.52],
  ['blob', 192, 151, -12, 0.62],
  ['pencil', 396, 116, 20, 1.06],
  ['pin', 76, 11, 17, 0.91],
  ['colorwheel', 102, 392, 19, 0.85],
  ['brush', 397, 343, 4, 0.73],
  ['bolt', 359, 197, -13, 1.20],
  ['type', 368, 21, -6, 1.21],
  ['sliders', 12, 13, 15, 0.61],
  ['wireframe', 453, 118, -10, 0.87],
  ['bubble-lines', 228, 425, 7, 0.61],
  ['rocket', 91, 77, -12, 0.53],
  ['sticky', 336, 78, 14, 0.74],
  ['mask', 365, 465, 11, 0.85],
  ['gradient', 332, 219, 14, 1.10],
  ['image', 275, 289, 14, 0.75],
  ['sticky', 173, 358, -15, 1.37],
  ['infinity', 242, 157, 19, 0.65],
  ['frame', 71, 43, -6, 0.51],
  ['asterisk', 91, 123, -8, 0.55],
  ['bolt', 320, 108, 20, 1.08],
  ['cloud-up', 443, 99, 19, 0.54],
  ['bubble-heart', 13, 121, -2, 0.81],
  ['play', 334, 156, -2, 0.57],
  ['gradient', 446, 33, -1, 1.19],
  ['link', 144, 324, -15, 0.49],
  ['brush', 102, 25, 13, 1.25],
  ['bubble-ask', 266, 203, 11, 0.49],
  ['loops', 79, 201, -7, 0.81],
  ['cursor', 71, 136, 0, 0.82],
  ['drop', 413, 310, 4, 0.88],
  ['pin', 112, 184, 20, 0.51],
  ['drop', 124, 230, -19, 0.55],
  ['link', 52, 224, -13, 0.49],
  ['pin', 262, 413, 2, 0.50],
  ['sparkle', 70, 436, -14, 0.49],
  ['bubble-double', 313, 378, -2, 0.77],
  ['export', 15, 281, 9, 0.87],
  ['play', 16, 157, -6, 0.72],
  ['bulb', 69, 470, 1, 1.26],
  ['mask', 413, 426, 10, 0.48],
  ['palette', 295, 273, 6, 1.17],
  ['undo', 40, 318, -12, 0.72],
  ['plus', 116, 453, 19, 0.80],
  ['toggle', 367, 370, 1, 0.65],
  ['pencil', 282, 209, -14, 0.54],
  ['bubble-double', 22, 215, 19, 0.90],
  ['bubble-heart', 111, 381, 21, 0.62],
  ['artboard', 395, 209, 12, 0.94],
  ['sparkle', 166, 334, 2, 0.53],
  ['bubble-lines', 151, 420, -2, 0.58],
  ['link', 186, 298, 5, 0.93],
  ['figma-stack', 230, 172, -11, 0.79],
  ['component', 111, 109, 1, 1.06],
  ['rocket', 76, 300, 10, 0.55],
  ['sparkle', 36, 300, 2, 0.52],
  ['export', 276, 361, 10, 0.53],
  ['bubble-lines', 197, 19, -16, 1.18],
  ['image', 342, 353, -19, 0.58],
  ['link', 144, 78, -9, 0.52],
  ['select', 418, 251, -14, 0.93],
  ['bubble-typing', 220, 204, -4, 1.06],
  ['brush', 186, 235, -10, 0.74],
  ['bubble-typing', 45, 380, -16, 1.18],
  ['bubble-typing', 14, 451, -2, 0.78],
  ['bubble-heart', 438, 159, 1, 1.07],
  ['sliders', 188, 417, -8, 1.37],
  ['frame', 391, 234, -10, 0.80],
  ['spiral', 151, 470, 20, 1.39],
  ['grid', 84, 229, -21, 1.24],
  ['smiley', 349, 87, -11, 0.50],
  ['bubble-heart', 25, 360, 8, 0.76],
  ['type', 367, 126, 10, 1.19],
  ['asterisk', 95, 199, 15, 0.53],
  ['flow', 228, 367, 11, 1.21],
  ['plus', 331, 280, 15, 0.89],
  ['bubble-typing', 375, 297, 3, 0.83],
  ['bubble-ask', 78, 347, -22, 0.93],
  ['sliders', 30, 91, 0, 0.57],
  ['align', 90, 384, -17, 0.48],
  ['bubble', 108, 242, -11, 0.62],
  ['play', 313, 11, -5, 0.87],
  ['bubble-ask', 140, 223, 18, 0.92],
  ['brush', 302, 205, 19, 0.79],
  ['bubble-ask', 74, 418, 21, 0.54],
  ['dots', 93, 343, -15, 0.61],
  ['bubble-ask', 131, 167, 19, 0.75],
  ['pen', 146, 126, 20, 0.65],
  ['ruler', 368, 152, -16, 0.58],
  ['heart', 27, 57, 13, 1.33],
  ['dots', 469, 289, -4, 0.51],
  ['pen', 149, 99, 11, 0.64],
  ['toggle', 198, 438, 14, 0.54],
  ['ruler', 438, 304, 15, 1.23],
  ['bezier', 197, 175, 15, 0.87],
  ['bubble-ask', 70, 73, -9, 0.76],
  ['bubble-ask', 33, 261, -5, 0.85],
  ['image', 12, 87, 18, 0.88],
  ['artboard', 469, 192, -3, 1.30],
  ['wireframe', 133, 295, 14, 0.55],
  ['grid', 447, 431, -18, 0.85],
  ['bubble-double', 37, 279, -14, 0.59],
  ['bubble-typing', 218, 123, 17, 0.86],
  ['cloud-up', 268, 44, -4, 0.65],
  ['cloud-up', 237, 250, 10, 0.76],
  ['cloud-up', 462, 249, 12, 0.93],
  ['bubble', 243, 18, 6, 0.85],
  ['squiggle', 302, 327, 6, 0.88],
  ['figma-stack', 402, 66, -3, 0.54],
  ['bubble-heart', 281, 76, -19, 0.60],
  ['eye', 311, 46, -14, 0.93],
  ['cmd', 187, 108, 0, 0.91],
  ['bubble-heart', 328, 455, -3, 0.75],
  ['bubble-lines', 19, 414, 6, 0.90],
  ['video', 123, 63, -12, 0.59],
  ['type', 368, 61, -6, 0.54],
  ['smiley', 108, 313, 8, 0.74],
  ['bubble-lines', 409, 13, -15, 0.49],
  ['bubble-ask', 466, 463, -5, 0.49],
  ['bubble-ask', 275, 242, -18, 0.83],
  ['bubble-typing', 108, 148, 2, 0.76],
  ['bubble-double', 27, 182, 16, 0.90],
  ['bubble-lines', 41, 15, 3, 0.60],
  ['palette', 101, 280, -3, 0.63],
  ['bubble-double', 119, 351, 16, 0.78],
  ['cloud-up', 266, 331, -10, 0.84],
  ['bubble', 54, 107, -1, 0.61],
  ['bubble-typing', 270, 142, 14, 0.61],
  ['wireframe', 46, 429, -22, 0.95],
  ['rocket', 361, 399, -16, 0.48],
  ['colorwheel', 373, 87, -13, 0.48],
  ['flow', 401, 379, -9, 0.90],
  ['eye', 143, 392, 8, 0.81],
  ['figma-stack', 154, 54, -20, 0.93],
  ['loops', 470, 70, -17, 0.78],
  ['bubble-heart', 335, 311, 2, 0.81],
  ['figma-stack', 369, 435, -16, 0.64],
  ['figma-stack', 469, 388, 4, 0.91],
  ['bubble-ask', 428, 72, 11, 0.88],
  ['squiggle', 13, 322, -9, 0.63],
  ['drop', 175, 81, 15, 0.89],
  ['bubble-lines', 247, 224, 3, 0.56],
  ['bubble-ask', 439, 469, 5, 0.94],
  ['asterisk', 38, 138, -12, 0.87],
  ['figma-stack', 123, 267, -0, 0.62],
  ['bezier', 219, -11, -15, 0.78],
  ['bubble-heart', -15, 342, 8, 1.07],
  ['grid', 284, -18, -15, 1.08],
  ['pin', 76, 491, 17, 0.91],
  ['type', 368, 501, -6, 1.21],
  ['bubble-heart', 493, 121, -2, 0.81],
  ['bulb', 69, -10, 1, 1.26],
  ['spiral', 151, -10, 20, 1.39],
  ['play', 313, 491, -5, 0.87],
  ['image', 492, 87, 18, 0.88],
  ['artboard', -11, 192, -3, 1.30],
  ['loops', -10, 70, -17, 0.78],
  ['figma-stack', -11, 388, 4, 0.91],
  ['bubble-ask', 439, -11, 5, 0.94],
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
