/**
 * Shared mobile layout tokens.
 *
 * Keep screen/component styles on this 4px rhythm so touch targets,
 * spacing, and typography stay consistent with docs/mobile-design-system.md.
 */
export const spacing = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 20,
  full: 9999,
} as const;

export const typography = {
  display: { fontSize: 34, lineHeight: 40, fontFamily: 'Geist_700Bold' },
  screenTitle: { fontSize: 24, lineHeight: 30, fontFamily: 'Geist_700Bold' },
  sectionTitle: { fontSize: 20, lineHeight: 25, fontFamily: 'Geist_600SemiBold' },
  bodyLarge: { fontSize: 17, lineHeight: 25, fontFamily: 'Geist_400Regular' },
  body: { fontSize: 16, lineHeight: 24, fontFamily: 'Geist_400Regular' },
  label: { fontSize: 15, lineHeight: 20, fontFamily: 'Geist_600SemiBold' },
  caption: { fontSize: 13, lineHeight: 18, fontFamily: 'Geist_400Regular' },
  micro: { fontSize: 11, lineHeight: 14, fontFamily: 'Geist_600SemiBold' },
} as const;

export const elevation = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  floating: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
} as const;