import { accent, neutral, signal } from "../tokens/colors";

export const darkTheme = {
  background: neutral.void,
  backgroundSubtle: neutral.carbon,
  surface: neutral.carbon,
  surfaceRaised: neutral.obsidian,
  foreground: neutral.paper,
  foregroundMuted: neutral.fog,
  foregroundSubtle: neutral.ash,
  accent: accent.blue,
  accentHover: accent.blueHover,
  accentSoft: neutral.obsidian,
  accentForeground: neutral.paper,
  border: neutral.graphite,
  borderSubtle: neutral.obsidian,
  signal,
  overlay: neutral.void,
  overlayRaised: neutral.carbon,
  overlayElevated: neutral.obsidian,
  overlayForeground: neutral.mist,
  overlayMuted: neutral.fog,
} as const;

export type DarkTheme = typeof darkTheme;
