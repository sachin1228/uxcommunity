/**
 * Semantic design tokens — mirrored from the web app's design system.
 * Source: packages/design-system + apps/web/app/globals.css (see
 * constants/designSystem.ts for the raw values and their provenance).
 *
 * Two naming layers live here:
 *   • the web design-system names (background, surfaceRaised, foregroundMuted,
 *     borderSubtle, overlay…), used by new code and by every web-parity port;
 *   • the legacy mobile names (card, primary, mutedForeground, subtle…) kept as
 *     aliases so existing screens keep working unchanged.
 *
 * Add new tokens to designSystem.ts, not here.
 */

import {
  DEFAULT_COLOR_SCHEME,
  chatNameColors,
  radius as radiusScale,
  themes,
  type ColorScheme,
  type SemanticTheme,
} from './designSystem';

export { DEFAULT_COLOR_SCHEME, radiusScale };
export type { ColorScheme };

export interface Palette extends SemanticTheme {
  // ── Legacy aliases (mobile pre-design-system names) ────────────────────
  text: string;
  tint: string;
  card: string;
  cardForeground: string;
  primary: string;
  primaryForeground: string;
  primaryHover: string;
  primarySoft: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  foregroundSoft: string;
  accentSoftRaised: string;
  input: string;
  subtle: string;

  // ── Chat ───────────────────────────────────────────────────────────────
  chatOwnBubble: string;
  chatOwnBubbleForeground: string;
  chatOwnBubblePressed: string;
  chatOwnBubbleTail: string;
  chatFailedBubble: string;
  chatMentionOwn: string;
  chatMention: string;
  chatNameFallback: string;
  chatReplyBgOther: string;
  chatReplyBorderOther: string;
  chatReplyBgOwn: string;
  chatReplyBorderOwn: string;
  chatReactionPill: string;
  chatUnreadPill: string;
  chatNameColors: string[];
}

function buildPalette(scheme: ColorScheme): Palette {
  const theme = themes[scheme];
  const isDark = scheme === 'dark';

  return {
    ...theme,

    // Legacy aliases
    text: theme.foreground,
    tint: theme.accent,
    card: theme.surface,
    cardForeground: theme.foreground,
    primary: theme.accent,
    primaryForeground: theme.accentForeground,
    primaryHover: theme.accentHover,
    primarySoft: theme.accentSoft,
    secondary: theme.surfaceRaised,
    secondaryForeground: theme.foreground,
    muted: theme.surfaceRaised,
    mutedForeground: theme.foregroundMuted,
    foregroundSoft: theme.foregroundSubtle,
    accentSoftRaised: theme.accentSoft,
    input: theme.inputBackground,
    subtle: theme.backgroundSubtle,

    // Chat — mirrors the web chat tokens in globals.css so a message looks
    // identical on both clients.
    chatOwnBubble: isDark ? '#0062d1' : '#0062D1',
    chatOwnBubbleForeground: '#FFFFFF',
    chatOwnBubblePressed: '#0068D6',
    chatOwnBubbleTail: '#0062D1',
    chatFailedBubble: 'rgba(239, 68, 68, 0.8)',
    chatMentionOwn: isDark ? '#52A8FF' : '#99CEFF',
    chatMention: '#0072F5',
    chatNameFallback: isDark ? '#737373' : '#525252',
    chatReplyBgOther: isDark ? 'rgba(0, 0, 0, 0.10)' : 'rgba(0, 0, 0, 0.06)',
    chatReplyBorderOther: isDark ? 'rgba(255, 255, 255, 0.15)' : '#DFDFDF',
    chatReplyBgOwn: 'rgba(0, 0, 0, 0.20)',
    chatReplyBorderOwn: isDark ? 'rgba(255, 255, 255, 0.20)' : 'rgba(255, 255, 255, 0.35)',
    chatReactionPill: '#2A2A2A',
    chatUnreadPill: '#0062D1',
    chatNameColors: [...chatNameColors[scheme]],
  };
}

const colors = {
  light: buildPalette('light'),
  dark: buildPalette('dark'),
  /** Default corner radius (px) applied to cards, buttons, inputs, and modals. */
  radius: radiusScale.md,
} as const;

export default colors;
