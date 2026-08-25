/** Elevation uses hairlines and subtle inset definition rather than glow. */
export const shadows = {
  none: "none",
  xs: "rgba(0, 0, 0, 0.2) 0 0 0 1px",
  sm: "rgba(0, 0, 0, 0.4) 0 2px 4px",
  md: "rgba(0, 0, 0, 0.2) 0 0 12px inset",
  lg: "rgba(8, 9, 10, 0.6) 0 4px 32px",
  xl: "rgba(8, 9, 10, 0.6) 0 4px 32px",
  card: "rgb(35, 37, 42) 0 0 0 1px inset",
} as const;

export type Shadows = typeof shadows;
