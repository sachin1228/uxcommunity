/** Typography tokens for compact, high-clarity product interfaces. */
export const fontFamily = {
  display: "var(--font-display), Inter, ui-sans-serif, system-ui, sans-serif",
  body: "var(--font-display), Inter, ui-sans-serif, system-ui, sans-serif",
  mono: "var(--font-mono), 'JetBrains Mono', ui-monospace, monospace",
} as const;

export const fontSize = {
  "2xs": "0.625rem",
  xs: "0.75rem",
  sm: "0.8125rem",
  base: "0.9375rem",
  md: "1rem",
  lg: "1.0625rem",
  xl: "1.25rem",
  "2xl": "1.5rem",
  "3xl": "2rem",
  "4xl": "3rem",
  "5xl": "4rem",
  display: "4.5rem",
} as const;

export const fontWeight = {
  light: "300",
  regular: "400",
  medium: "510",
  semibold: "590",
  bold: "590",
} as const;

export const lineHeight = {
  none: "1",
  tight: "1.13",
  snug: "1.33",
  normal: "1.5",
  relaxed: "1.6",
} as const;

export const letterSpacing = {
  tighter: "-0.022em",
  tight: "-0.012em",
  normal: "0",
  wide: "0.04em",
  wider: "0.08em",
  widest: "0.12em",
} as const;

export const typography = { fontFamily, fontSize, fontWeight, lineHeight, letterSpacing } as const;
