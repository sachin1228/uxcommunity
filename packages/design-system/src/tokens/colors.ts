/**
 * Raw color palette — all primitive values.
 * These are the foundation of the design system; do not use them directly
 * in UI code. Reference semantic tokens from `themes/` instead.
 *
 * Scales follow the same 100–1000 convention used by Cloudflare and Geist:
 * lower numbers = lighter shades, higher numbers = darker shades.
 */

export const purple = {
  100: "#F0EFFE",
  200: "#DDD9FB",
  300: "#C4BCF8",
  400: "#9B90F3",
  500: "#5B4FE8", // primary brand accent
  600: "#4B3FD6",
  700: "#3A30B8",
  800: "#2B2392",
  900: "#1C1768",
} as const;

export const neutral = {
  0:    "#FFFFFF",
  50:   "#FAFAFA",
  100:  "#F5F5F7",
  200:  "#E8E8ED",
  300:  "#D1D1D9",
  400:  "#9A9AAD",
  500:  "#6B6B7B",
  600:  "#4A4A5A",
  700:  "#2D2D3A",
  800:  "#1A1A24",
  900:  "#0F0F16",
  1000: "#07070C",
} as const;

/** draft/ brand signal — always the same across modes */
export const signal = "#C8FF5B" as const;

export const colors = {
  purple,
  neutral,
  signal,
} as const;

export type Colors = typeof colors;
