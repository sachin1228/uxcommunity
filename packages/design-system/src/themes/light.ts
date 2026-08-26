import { neutral, signal, dark } from "../tokens/colors";

/**
 * Light theme — black (#0A0A0A) as primary accent (Vercel-style inversion),
 * #333333 as hover.
 */
export const lightTheme = {
  background:        neutral[50],
  backgroundSubtle:  neutral[100],

  surface:           neutral[0],
  surfaceRaised:     neutral[100],

  foreground:        neutral[1000],
  foregroundMuted:   neutral[600],
  foregroundSubtle:  neutral[500],

  accent:            neutral[1000], // black primary (Vercel light-mode inversion)
  accentHover:       "#333333" as const,
  accentSoft:        neutral[200],  // tinted bg
  accentForeground:  neutral[0],

  border:            neutral[200],
  borderSubtle:      neutral[100],

  signal,

  overlay:           dark[900],
  overlayRaised:     dark[800],
  overlayElevated:   dark[700],
  overlayForeground: dark[100],
  overlayMuted:      dark[400],
} as const;

export type LightTheme = typeof lightTheme;
