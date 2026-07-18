import { neutral, orange, signal, warm } from "../tokens/colors";

/**
 * Dark theme — semantic color mappings.
 * Warm charcoal backgrounds (not cold blue-black) with orange accent.
 */
export const darkTheme = {
  /** Page and panel backgrounds */
  background:        warm[900],     // #161413 — warm dark
  backgroundSubtle:  warm[800],     // #1B1918

  /** Card / elevated surfaces */
  surface:           warm[800],     // #1B1918
  surfaceRaised:     warm[700],     // #262220 — cards, panels

  /** Text */
  foreground:        warm[100],     // #F5F2F0 — primary text
  foregroundMuted:   warm[400],     // #7B7B7B — secondary text
  foregroundSubtle:  neutral[500],  // #7B7B7B — tertiary

  /** Accent — slightly brighter for dark-mode legibility */
  accent:            orange[400],   // #ff5e1f
  accentHover:       orange[500],   // #E65012
  accentSoft:        warm[700],     // #262220
  accentForeground:  neutral[0],    // white text on accent bg

  /** Borders */
  border:            warm[600],     // #2F2B29
  borderSubtle:      warm[700],     // #262220

  /** Brand signal — stays vivid in both modes */
  signal,                           // #1289ff

  /** Always-dark overlay panel */
  overlay:           warm[900],     // #161413
  overlayRaised:     warm[800],     // #1B1918
  overlayElevated:   warm[700],     // #262220
  overlayForeground: warm[100],     // #F5F2F0
  overlayMuted:      warm[400],     // #7B7B7B
} as const;

export type DarkTheme = typeof darkTheme;
