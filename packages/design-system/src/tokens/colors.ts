/**
 * Raw color palette — all primitive values.
 * These are the foundation of the design system; do not use them directly
 * in UI code. Reference semantic tokens from `themes/` instead.
 *
 * Official Geist scales — https://vercel.com/geist/colors
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

export const red = {
  100:  "#fff0f0",
  200:  "#ffebeb",
  300:  "#ffe5e5",
  400:  "#fdd8d8",
  500:  "#f8b9b9",
  600:  "#f87275",
  700:  "#e5484d",
  800:  "#da2f35",
  900:  "#cb2a2f",
  1000: "#391417",
} as const;

export const redDark = {
  100:  "#2a1314",
  200:  "#3c1618",
  300:  "#561a1e",
  400:  "#671e21",
  500:  "#832126",
  600:  "#e5484d",
  700:  "#e5484d",
  800:  "#d93036",
  900:  "#ff6166",
  1000: "#feecee",
} as const;

export const amber = {
  100:  "#fff6e5",
  200:  "#fff4d6",
  300:  "#fef0cd",
  400:  "#ffdd8f",
  500:  "#ffc96b",
  600:  "#f5b047",
  700:  "#ffb224",
  800:  "#ff990a",
  900:  "#a35200",
  1000: "#4e2009",
} as const;

export const amberDark = {
  100:  "#291800",
  200:  "#331b00",
  300:  "#4d2a00",
  400:  "#573300",
  500:  "#6b4105",
  600:  "#e79d13",
  700:  "#ffb224",
  800:  "#ff990a",
  900:  "#ff990a",
  1000: "#fef3dc",
} as const;

export const green = {
  100:  "#effbef",
  200:  "#ebfaeb",
  300:  "#daf6da",
  400:  "#c6f1c7",
  500:  "#99e69e",
  600:  "#6cda75",
  700:  "#45a557",
  800:  "#398e4a",
  900:  "#297a3a",
  1000: "#1b311e",
} as const;

export const greenDark = {
  100:  "#0b2212",
  200:  "#0f2e18",
  300:  "#12361b",
  400:  "#0c451b",
  500:  "#126426",
  600:  "#1a9338",
  700:  "#45a557",
  800:  "#398e4a",
  900:  "#62c073",
  1000: "#e5fbea",
} as const;

export const teal = {
  100:  "#eefcf9",
  200:  "#e5faf6",
  300:  "#d4f7f0",
  400:  "#bef4eb",
  500:  "#86ead9",
  600:  "#45dec5",
  700:  "#12a594",
  800:  "#0d8c7d",
  900:  "#067a6e",
  1000: "#073c34",
} as const;

export const tealDark = {
  100:  "#04201b",
  200:  "#062822",
  300:  "#083a33",
  400:  "#053d35",
  500:  "#085e53",
  600:  "#0c9784",
  700:  "#12a594",
  800:  "#0d8c7d",
  900:  "#0ac7b4",
  1000: "#e0faf4",
} as const;

export const purple = {
  100:  "#f9f0ff",
  200:  "#f9f1fe",
  300:  "#f4e8fc",
  400:  "#eddcf9",
  500:  "#d5b1f1",
  600:  "#bf89ec",
  700:  "#8e4ec6",
  800:  "#763da9",
  900:  "#7820bc",
  1000: "#2e004d",
} as const;

export const purpleDark = {
  100:  "#231528",
  200:  "#2e1938",
  300:  "#422154",
  400:  "#4f2768",
  500:  "#5f2e85",
  600:  "#8e4ec6",
  700:  "#8e4ec6",
  800:  "#763da9",
  900:  "#bf7af0",
  1000: "#f8edfc",
} as const;

export const pink = {
  100:  "#ffebf5",
  200:  "#feecf2",
  300:  "#fce3ec",
  400:  "#f9d7e2",
  500:  "#f5b8cc",
  600:  "#ee87a7",
  700:  "#ea3e83",
  800:  "#df2670",
  900:  "#bd2864",
  1000: "#430a23",
} as const;

export const pinkDark = {
  100:  "#28151d",
  200:  "#3a1726",
  300:  "#4f1c31",
  400:  "#551b33",
  500:  "#6c1e3e",
  600:  "#b31957",
  700:  "#ea3e83",
  800:  "#df2670",
  900:  "#f75f8f",
  1000: "#feecf4",
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
  red,
  redDark,
  amber,
  amberDark,
  green,
  greenDark,
  teal,
  tealDark,
  purple,
  purpleDark,
  pink,
  pinkDark,
  neutral,
  dark,
  signal,
} as const;

export type Colors = typeof colors;
