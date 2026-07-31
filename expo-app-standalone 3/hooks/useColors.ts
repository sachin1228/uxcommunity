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
  const palette =
    scheme === 'dark' && 'dark' in colors
      ? (colors as Record<string, typeof colors.light>).dark
      : colors.light;
  return { ...palette, radius: colors.radius };
}
