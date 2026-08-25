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
  blue: "#0070f3",
  blueHover: "#0064d9",
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
  100: "#e8f2ff",
  200: "#c9e0ff",
  300: "#9bc5ff",
  400: "#3d8df4",
  500: accent.blue,
  600: accent.blueHover,
  700: "#0059bd",
  800: "#004a9e",
  900: "#003d82",
  1000: "#002a5c",
} as const;

export const dark = neutral;
export const signal = accent.blue;
export const colors = { neutral, accent, blue, dark, signal } as const;
export type Colors = typeof colors;
