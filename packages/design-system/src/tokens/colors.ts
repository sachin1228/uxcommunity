/**
 * Raw color palette — all primitive values.
 * These are the foundation of the design system; do not use them directly
 * in UI code. Reference semantic tokens from `themes/` instead.
 *
 * Official Geist blue scale — 100 = darkest, 1000 = lightest.
 * Source: vercel.com/geist/colors
 */

export const blue = {
  100:  "#000b1f", // deepest navy
  200:  "#00254d",
  300:  "#003c85",
  400:  "#0057b7",
  500:  "#006bdb",
  600:  "#0070F3", // ← PRIMARY brand accent
  700:  "#52a8ff",
  800:  "#adcfff",
  900:  "#d9ecff",
  1000: "#f0f8ff", // barely-there tint — soft backgrounds
} as const;

/** Geist Neutral — clean, cool-neutral grays */
export const neutral = {
  0:    "#FFFFFF",
  50:   "#FAFAFA",
  100:  "#F5F5F5",
  200:  "#EAEAEA",
  300:  "#E0E0E0",
  400:  "#A8A8A8",
  500:  "#737373",
  600:  "#525252",
  700:  "#404040",
  800:  "#262626",
  900:  "#171717",
  1000: "#0A0A0A",
} as const;

/** Geist Dark — near-black backgrounds for dark mode */
export const dark = {
  900: "#0A0A0A",
  800: "#111111",
  700: "#1A1A1A",
  600: "#2E2E2E",
  500: "#3E3E3E",
  400: "#737373",
  100: "#EDEDED",
} as const;

/** Brand signal */
export const signal = blue[600] as const;

export const colors = {
  blue,
  neutral,
  dark,
  signal,
} as const;

export type Colors = typeof colors;
