import { neutral, purple, signal } from "../tokens/colors";

/**
 * Light theme — semantic color mappings.
 * Inspired by Cloudflare's clean white-dominant light mode:
 * pure white surfaces, very dark foreground, crisp borders.
 */
export const lightTheme = {
  /** Page and panel backgrounds */
  background:        neutral[0],    // #FFFFFF — pure white canvas
  backgroundSubtle:  neutral[100],  // #F5F5F7 — alternate section bg

  /** Card / elevated surfaces */
  surface:           neutral[0],    // #FFFFFF
  surfaceRaised:     neutral[50],   // #FAFAFA — slightly elevated

  /** Text */
  foreground:        neutral[900],  // #0F0F16 — primary text
  foregroundMuted:   neutral[500],  // #6B6B7B — secondary text
  foregroundSubtle:  neutral[400],  // #9A9AAD — placeholder / tertiary

  /** Accent (draft/ purple brand) */
  accent:            purple[500],   // #5B4FE8
  accentHover:       purple[600],   // #4B3FD6
  accentSoft:        purple[100],   // #F0EFFE — tinted bg
  accentForeground:  neutral[0],    // white text on accent bg

  /** Borders */
  border:            neutral[200],  // #E8E8ED
  borderSubtle:      neutral[100],  // #F5F5F7

  /** Brand signal */
  signal,                           // #C8FF5B

  /** Always-dark overlay panel (brand canvas, code blocks, etc.) */
  overlay:           neutral[900],  // #0F0F16
  overlayRaised:     neutral[800],  // #1A1A24
} as const;

export type LightTheme = typeof lightTheme;
