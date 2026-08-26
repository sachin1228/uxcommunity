import { neutral, signal, dark } from "../tokens/colors";

/**
 * Dark theme — white (#ffffff) as accent (Vercel-style primary),
 * #cccccc as hover (slightly dimmed).
 */
export const darkTheme = {
  background:        dark[900],
  backgroundSubtle:  dark[800],

  surface:           dark[800],
  surfaceRaised:     dark[700],

  foreground:        dark[100],
  foregroundMuted:   dark[400],
  foregroundSubtle:  neutral[500],

  accent:            "#FFFFFF" as const,  // white primary (Vercel)
  accentHover:       "#CCCCCC" as const,  // hover dims slightly
  accentSoft:        dark[700],
  accentForeground:  neutral[1000],       // black text on white

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
