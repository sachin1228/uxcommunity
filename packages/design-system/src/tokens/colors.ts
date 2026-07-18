/**
 * Raw color palette — all primitive values.
 * These are the foundation of the design system; do not use them directly
 * in UI code. Reference semantic tokens from `themes/` instead.
 *
 * Scales follow the same 100–1000 convention used by Cloudflare and Geist:
 * lower numbers = lighter shades, higher numbers = darker shades.
 */

export const orange = {
  50:  "#FFF7F2",
  100: "#FFE9DD",
  200: "#FFD0BA",
  300: "#FFB089",
  400: "#FF874F",
  500: "#E65012", // primary brand accent (light mode)
  600: "#E54E12",
  700: "#C53F0D",
  800: "#9B320C",
  900: "#6F2408",
} as const;

export const neutral = {
  0:    "#FFFFFF",
  50:   "#FAFAFA",
  100:  "#F5F5F5",
  200:  "#ECECEC",
  300:  "#E2E2E2",
  400:  "#B5B5B5",
  500:  "#7B7B7B",
  600:  "#5A5A5A",
  700:  "#3D3D3D",
  800:  "#252525",
  900:  "#171717",
  1000: "#0D0D0D",
} as const;

/** Warm charcoal — used for overlay panels and dark-mode backgrounds */
export const warm = {
  900: "#161413", // deepest warm dark (bg)
  800: "#1B1918", // overlay raised
  700: "#262220", // overlay elevated
  600: "#2F2B29", // border on dark
  500: "#3D3835", // input border on dark
  400: "#7B7B7B", // muted text
  100: "#F5F2F0", // foreground on dark
} as const;

/** draft/ brand signal — keeps lime for contrast against orange */
export const signal = "#1289ff" as const;

export const colors = {
  orange,
  neutral,
  warm,
  signal,
} as const;

export type Colors = typeof colors;
