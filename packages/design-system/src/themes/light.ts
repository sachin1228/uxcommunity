import { neutral, orange, signal, warm } from "../tokens/colors";

/**
 * Light theme — semantic color mappings.
 * Inspired by Cloudflare's clean white-dominant light mode:
 * pure white surfaces, very dark foreground, crisp borders.
 */
export const lightTheme = {
  /** Page and panel backgrounds */
  background:        neutral[0],    // #FFFFFF — pure white canvas
  backgroundSubtle:  neutral[50],   // #FAFAFA — alternate section bg

  /** Card / elevated surfaces */
  surface:           neutral[0],    // #FFFFFF
  surfaceRaised:     neutral[100],  // #F5F5F5 — slightly elevated

  /** Text */
  foreground:        neutral[900],  // #171717 — primary text
  foregroundMuted:   neutral[600],  // #5A5A5A — secondary text
  foregroundSubtle:  neutral[500],  // #7B7B7B — placeholder / tertiary

  /** Accent (draft/ orange brand) */
  accent:            orange[500],   // #FF5E1F
  accentHover:       orange[600],   // #E54E12
  accentSoft:        orange[100],   // #FFE9DD — tinted bg
  accentForeground:  neutral[0],    // white text on accent bg

  /** Borders */
  border:            neutral[200],  // #ECECEC
  borderSubtle:      neutral[100],  // #F5F5F5

  /** Brand signal */
  signal,                           // #1289ff

  /** Always-dark overlay panel (brand canvas, code blocks, etc.) */
  overlay:           warm[900],     // #161413 — warm charcoal
  overlayRaised:     warm[800],     // #1B1918
  overlayElevated:   warm[700],     // #262220
  overlayForeground: warm[100],     // #F5F2F0
  overlayMuted:      warm[400],     // #7B7B7B
} as const;

export type LightTheme = typeof lightTheme;
