/**
 * Typography tokens.
 * Font families are consumed as CSS custom properties injected by Next.js
 * via `next/font/google` in the root layout.
 */

export const fontFamily = {
  display: "var(--font-display), sans-serif",
  body:    "var(--font-body), ui-sans-serif, system-ui, sans-serif",
  mono:    "var(--font-mono), ui-monospace, monospace",
} as const;

export const fontSize = {
  "2xs": "0.625rem",   // 10px
  xs:    "0.6875rem",  // 11px
  sm:    "0.8125rem",  // 13px
  base:  "0.875rem",   // 14px
  md:    "1rem",       // 16px
  lg:    "1.125rem",   // 18px
  xl:    "1.25rem",    // 20px
  "2xl": "1.5rem",     // 24px
  "3xl": "1.875rem",   // 30px
  "4xl": "2.25rem",    // 36px
} as const;

export const fontWeight = {
  regular:   "400",
  medium:    "500",
  semibold:  "600",
  bold:      "700",
} as const;

export const lineHeight = {
  none:    "1",
  tight:   "1.25",
  snug:    "1.375",
  normal:  "1.5",
  relaxed: "1.625",
} as const;

export const letterSpacing = {
  tighter: "-0.04em",
  tight:   "-0.02em",
  normal:  "0em",
  wide:    "0.04em",
  wider:   "0.08em",
  widest:  "0.12em",
} as const;

export const typography = {
  fontFamily,
  fontSize,
  fontWeight,
  lineHeight,
  letterSpacing,
} as const;
