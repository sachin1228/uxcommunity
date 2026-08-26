/**
 * Raw color palette — all primitive values.
 * These are the foundation of the design system; do not use them directly
 * in UI code. Reference semantic tokens from `themes/` instead.
 *
 * Official Geist blue scale — https://vercel.com/geist/colors
 * 100 = lightest tint … 1000 = darkest. Step usage:
 * 100 default bg · 200 hover bg · 300 active bg · 400 default border ·
 * 500 hover border · 600 active border · 700 high-contrast bg ·
 * 800 hover high-contrast bg · 900 secondary text · 1000 primary text.
 * Light and dark themes ship separate hand-picked values.
 */

export const blue = {
  100:  "#f0f7ff",
  200:  "#ebf5ff",
  300:  "#e0f0ff",
  400:  "#cce6ff",
  500:  "#99ceff",
  600:  "#52aeff",
  700:  "#0072f5",
  800:  "#0062d1",
  900:  "#0068d6",
  1000: "#00254d",
} as const;

/** Geist blue scale — dark theme values */
export const blueDark = {
  100:  "#0f1c2e",
  200:  "#10233d",
  300:  "#0f2f57",
  400:  "#0d3868",
  500:  "#0a4380",
  600:  "#0090ff",
  700:  "#0072f5",
  800:  "#0062d1",
  900:  "#52a8ff",
  1000: "#ebf6ff",
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
export const signal = "#FFFFFF" as const;

export const colors = {
  blue,
  blueDark,
  neutral,
  dark,
  signal,
} as const;

export type Colors = typeof colors;
