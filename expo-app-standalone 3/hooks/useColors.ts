import { useColorScheme } from 'react-native';
import colors, { DEFAULT_COLOR_SCHEME, type ColorScheme } from '@/constants/colors';

/**
 * Returns design tokens for the active colour scheme.
 *
 * The web app renders dark-only, so — unlike the platform default — this hook
 * resolves to the dark palette unless the caller explicitly asks otherwise
 * (`useColors('light')`) or opts the device back in with
 * `EXPO_PUBLIC_COLOR_SCHEME=light`.
 *
 * The resolved scheme is returned alongside the palette so screens can style
 * native chrome (status bar, refresh control, blur tint) to match the tokens
 * they just rendered with.
 */
export function useColors(override?: ColorScheme) {
  const deviceScheme = useColorScheme();
  const envScheme =
    process.env.EXPO_PUBLIC_COLOR_SCHEME === 'light' ||
    process.env.EXPO_PUBLIC_COLOR_SCHEME === 'dark'
      ? (process.env.EXPO_PUBLIC_COLOR_SCHEME as ColorScheme)
      : undefined;

  const scheme: ColorScheme = override ?? envScheme ?? DEFAULT_COLOR_SCHEME;
  const palette = scheme === 'dark' ? colors.dark : colors.light;
  const isDark = scheme === 'dark';

  return {
    ...palette,
    scheme,
    isDark,
    /** Kept for callers that still branch on the raw device scheme. */
    deviceScheme,
    radius: colors.radius,
  };
}
