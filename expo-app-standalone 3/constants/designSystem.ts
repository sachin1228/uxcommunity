/**
 * Mobile mirror of the web design system.
 *
 * Values come from:
 *   packages/design-system/src/tokens/colors.ts   (primitive scales)
 *   packages/design-system/src/themes/{light,dark}.ts  (semantic themes)
 *   apps/web/app/globals.css                      (semantic extras: field rings,
 *                                                  surfaces, overlays, --like)
 *
 * Keep this file and the web tokens in sync — a colour that exists on one
 * client and not the other is what makes a message or a card "look different on
 * mobile". Screens should read the theme through `useColors()`, never from the
 * primitive scales below.
 */

// ─── Geist primitive scales ────────────────────────────────────────────────

export const blue = {
  100: '#f0f7ff',
  200: '#ebf5ff',
  300: '#e0f0ff',
  400: '#cce6ff',
  500: '#99ceff',
  600: '#52aeff',
  700: '#0072f5',
  800: '#0062d1',
  900: '#0068d6',
  1000: '#00254d',
} as const;

export const blueDark = {
  100: '#0f1c2e',
  200: '#10233d',
  300: '#0f2f57',
  400: '#0d3868',
  500: '#0a4380',
  600: '#0090ff',
  700: '#0072f5',
  800: '#0062d1',
  900: '#52a8ff',
  1000: '#ebf6ff',
} as const;

export const red = {
  100: '#fff0f0',
  200: '#ffebeb',
  600: '#f87275',
  700: '#e5484d',
  800: '#da2f35',
  900: '#ff6166',
  1000: '#391417',
} as const;

export const redDark = {
  100: '#2a1314',
  600: '#e5484d',
  700: '#e5484d',
  800: '#d93036',
  900: '#ff6166',
  1000: '#feecee',
} as const;

export const neutral = {
  0: '#FFFFFF',
  50: '#FAFAFA',
  100: '#F5F5F5',
  200: '#EAEAEA',
  300: '#E0E0E0',
  400: '#A8A8A8',
  500: '#737373',
  600: '#525252',
  700: '#404040',
  800: '#262626',
  900: '#171717',
  1000: '#0A0A0A',
} as const;

// ─── Semantic themes ───────────────────────────────────────────────────────

export interface SemanticTheme {
  /** Page / app background. */
  background: string;
  /** Sidebars and recessed chrome. */
  backgroundSubtle: string;
  surface: string;
  /** Cards, panels, raised bubbles. */
  surfaceRaised: string;
  surfaceHover: string;
  inputBackground: string;

  foreground: string;
  foregroundMuted: string;
  foregroundSubtle: string;

  /** Primary action colour — white in dark mode, black in light (Vercel). */
  accent: string;
  accentHover: string;
  accentSoft: string;
  accentForeground: string;

  border: string;
  borderSubtle: string;
  borderStrong: string;
  inputBorder: string;

  /** Modals / drawers / tooltips — always dark, in both themes. */
  overlay: string;
  overlayRaised: string;
  overlayElevated: string;
  overlayForeground: string;
  overlayMuted: string;

  destructive: string;
  destructiveForeground: string;
  /** Green unread badge (web `bg-green-500`). */
  success: string;
  successForeground: string;
  /** The "liked" heart (web `--like`). */
  like: string;
}

export const lightTheme: SemanticTheme = {
  background: '#FAFAFA',
  backgroundSubtle: '#F5F5F5',
  surface: '#FFFFFF',
  surfaceRaised: '#F5F5F5',
  surfaceHover: '#EBEBEB',
  inputBackground: '#FAFAFA',

  foreground: '#0A0A0A',
  foregroundMuted: neutral[600],
  foregroundSubtle: neutral[500],

  accent: '#0A0A0A',
  accentHover: '#333333',
  accentSoft: '#EBEBEB',
  accentForeground: '#FFFFFF',

  border: '#EAEAEA',
  borderSubtle: '#F5F5F5',
  borderStrong: '#D4D4D4',
  inputBorder: '#E0E0E0',

  overlay: '#0A0A0A',
  overlayRaised: '#111111',
  overlayElevated: '#1A1A1A',
  overlayForeground: '#EDEDED',
  overlayMuted: '#737373',

  destructive: '#E5484D',
  destructiveForeground: '#FFFFFF',
  success: '#22C55E',
  successForeground: '#FFFFFF',
  like: '#F91880',
};

export const darkTheme: SemanticTheme = {
  background: '#09090B',
  backgroundSubtle: '#0E0E10',
  surface: '#121214',
  surfaceRaised: '#1B1B1F',
  surfaceHover: '#17171A',
  inputBackground: '#151517',

  foreground: '#EDEDED',
  foregroundMuted: neutral[500],
  foregroundSubtle: neutral[600],

  accent: '#FFFFFF',
  accentHover: '#CCCCCC',
  accentSoft: '#1F1F23',
  accentForeground: '#000000',

  border: '#202024',
  borderSubtle: '#1D1D21',
  borderStrong: '#2D2D34',
  inputBorder: '#303036',

  overlay: '#09090B',
  overlayRaised: '#121214',
  overlayElevated: '#1B1B1F',
  overlayForeground: '#EDEDED',
  overlayMuted: '#737373',

  destructive: '#E5484D',
  destructiveForeground: '#FFFFFF',
  success: '#22C55E',
  successForeground: '#FFFFFF',
  like: '#F91880',
};

export const themes = { light: lightTheme, dark: darkTheme } as const;

export type ColorScheme = keyof typeof themes;

/**
 * The web app renders dark-only (`colorScheme: "dark"` in the root metadata),
 * so the mobile app does too — a light-mode phone must not see a different
 * product than the browser.
 */
export const DEFAULT_COLOR_SCHEME: ColorScheme = 'dark';

// ─── Radius & elevation ────────────────────────────────────────────────────

/** Numeric (RN) counterpart of packages/design-system `radius`. */
export const radius = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 20,
  full: 9999,
} as const;

/**
 * Elevation descriptors. The web design guidelines prefer soft shadows over
 * borders, so cards and floating surfaces read these instead of `borderWidth`.
 */
export const shadows = {
  none: {},
  xs: {
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  sm: {
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  md: {
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  lg: {
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
} as const;

/** Web `--chat-name-0…6`, indexed by a stable hash of the user id. */
export const chatNameColors = {
  light: ['#0072F5', '#0D8C7D', '#8E4EC6', '#EA3E83', '#A35200', '#398E4A', '#E5484D'],
  dark: ['#52A8FF', '#0AC7B4', '#BF7AF0', '#F75F8F', '#FFB224', '#62C073', '#FF6166'],
} as const;
