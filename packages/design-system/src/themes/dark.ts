import { neutral, purple, signal } from "../tokens/colors";

/**
 * Dark theme — semantic color mappings.
 * Inspired by Cloudflare's deep, rich dark mode:
 * near-black backgrounds with clear surface layering and
 * elevated accent brightness for legibility.
 */
export const darkTheme = {
  /** Page and panel backgrounds */
  background:        neutral[1000], // #07070C — deepest dark
  backgroundSubtle:  neutral[900],  // #0F0F16

  /** Card / elevated surfaces */
  surface:           neutral[900],  // #0F0F16
  surfaceRaised:     neutral[800],  // #1A1A24 — cards, panels

  /** Text */
  foreground:        neutral[100],  // #F5F5F7 — primary text
  foregroundMuted:   neutral[400],  // #9A9AAD — secondary text
  foregroundSubtle:  neutral[500],  // #6B6B7B — tertiary

  /** Accent — brighter in dark mode for legibility */
  accent:            purple[400],   // #9B90F3
  accentHover:       purple[300],   // #C4BCF8
  accentSoft:        neutral[800],  // #1A1A24 with purple tint handled via CSS
  accentForeground:  neutral[0],    // white text on accent bg

  /** Borders */
  border:            neutral[800],  // #1A1A24
  borderSubtle:      neutral[900],  // #0F0F16

  /** Brand signal — stays vivid in both modes */
  signal,                           // #C8FF5B

  /** Always-dark overlay panel */
  overlay:           neutral[900],  // #0F0F16
  overlayRaised:     neutral[800],  // #1A1A24
} as const;

export type DarkTheme = typeof darkTheme;
