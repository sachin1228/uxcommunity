import { neutral, blue, signal, dark } from "../tokens/colors";

/**
 * Dark theme — Geist blue-700 (#52a8ff) as accent (lighter for dark bg legibility),
 * blue-600 (#0070f3) as hover (slightly darker).
 */
export const darkTheme = {
  background:        dark[900],
  backgroundSubtle:  dark[800],

  surface:           dark[800],
  surfaceRaised:     dark[700],

  foreground:        dark[100],
  foregroundMuted:   dark[400],
  foregroundSubtle:  neutral[500],

  accent:            blue[700],     // #52a8ff — lighter for dark bg
  accentHover:       blue[600],     // #0070f3 — hover goes slightly darker
  accentSoft:        dark[700],
  accentForeground:  neutral[0],

  border:            dark[600],
  borderSubtle:      dark[700],

  signal,

  overlay:           dark[900],
  overlayRaised:     dark[800],
  overlayElevated:   dark[700],
  overlayForeground: dark[100],
  overlayMuted:      dark[400],
} as const;

export type DarkTheme = typeof darkTheme;
