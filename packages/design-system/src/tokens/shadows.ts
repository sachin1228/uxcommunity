/**
 * Shadow tokens — Geist / Vercel style.
 * Elevation is communicated through border contrast, not heavy drop shadows.
 * Card-level elevation uses a 1px border ring as the primary cue.
 */

export const shadows = {
  none: "none",
  xs:   "0 1px 2px 0 rgb(0 0 0 / 0.05)",
  sm:   "0 1px 3px 0 rgb(0 0 0 / 0.05), 0 1px 2px -1px rgb(0 0 0 / 0.05)",
  md:   "0 4px 6px -1px rgb(0 0 0 / 0.05), 0 2px 4px -2px rgb(0 0 0 / 0.05)",
  lg:   "0 10px 15px -3px rgb(0 0 0 / 0.06), 0 4px 6px -4px rgb(0 0 0 / 0.05)",
  xl:   "0 20px 25px -5px rgb(0 0 0 / 0.06), 0 8px 10px -6px rgb(0 0 0 / 0.05)",
  card: "0 0 0 1px var(--color-border), 0 2px 4px rgb(0 0 0 / 0.04)",
} as const;

export type Shadows = typeof shadows;
