/** A restrained three-step radius vocabulary plus pills. */
export const radius = {
  none: "0px",
  sm: "2px",
  md: "6px",
  lg: "6px",
  xl: "12px",
  "2xl": "12px",
  full: "9999px",
} as const;

export type Radius = typeof radius;
