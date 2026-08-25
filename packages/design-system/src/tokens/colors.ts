/** Primitive colors for the midnight precision design language. */
export const neutral = {
  void: "#08090a",
  carbon: "#0f1011",
  obsidian: "#161718",
  graphite: "#23252a",
  smoke: "#383b3f",
  ash: "#62666d",
  fog: "#8a8f98",
  mist: "#d0d6e0",
  bone: "#e5e5e6",
  paper: "#ffffff",
} as const;

export const accent = {
  lime: "#e4f222",
  limeHover: "#d5e31f",
  green: "#27a644",
  red: "#eb5757",
  teal: "#02b8cc",
  iris: "#6366f1",
  lavender: "#8b5cf6",
} as const;

/** Backward-compatible alias; new interfaces should consume semantic themes. */
export const blue = {
  100: neutral.void,
  200: neutral.carbon,
  300: neutral.obsidian,
  400: accent.limeHover,
  500: accent.lime,
  600: accent.lime,
  700: accent.lime,
  800: neutral.mist,
  900: neutral.bone,
  1000: neutral.paper,
} as const;

export const dark = neutral;
export const signal = accent.lime;
export const colors = { neutral, accent, blue, dark, signal } as const;
export type Colors = typeof colors;
