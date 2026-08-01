import { useColorScheme } from 'react-native';
import colors from '@/constants/colors';

/**
 * Returns design tokens for the current color scheme.
 *
 * Falls back to light palette when no `dark` key exists in constants/colors.ts.
 * Add a `dark` key there to enable automatic dark-mode switching.
 */
export function useColors() {
  const scheme = useColorScheme();
  const palettes = colors as { light: typeof colors.light; dark?: typeof colors.light };
  const palette =
    scheme === 'dark' && palettes.dark
      ? palettes.dark
      : colors.light;
  return { ...palette, radius: colors.radius };
}
