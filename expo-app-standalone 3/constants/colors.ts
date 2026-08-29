/**
 * Semantic design tokens — mirrored from the web app's design system.
 * Source: apps/web/app/globals.css + packages/design-system/src/tokens/colors.ts
 */

const colors = {
  light: {
    // Legacy alias
    text: '#0A0A0A',
    tint: '#0A0A0A',

    // Core surfaces
    background: '#FAFAFA',
    foreground: '#0A0A0A',

    // Cards / elevated surfaces
    card: '#FFFFFF',
    cardForeground: '#0A0A0A',

    // Primary action color — buttons, links, active states
    primary: '#0A0A0A',
    primaryForeground: '#FFFFFF',
    primaryHover: '#333333',
    primarySoft: '#EBEBEB',

    // Secondary / less-emphasis surfaces
    secondary: '#F5F5F5',
    secondaryForeground: '#0A0A0A',

    // Muted / subdued elements
    muted: '#F5F5F5',
    mutedForeground: '#737373',
    foregroundSoft: '#8a8a8a',

    // Accent (same as primary in light mode)
    accent: '#0A0A0A',
    accentForeground: '#FFFFFF',
    accentSoft: '#EBEBEB',

    // Destructive / error states
    destructive: '#ef4444',
    destructiveForeground: '#FFFFFF',

    // Success / positive states — unread badge (mirrors web bg-green-500)
    success: '#22c55e',
    successForeground: '#FFFFFF',

    // Borders and input outlines
    border: '#EAEAEA',
    input: '#EAEAEA',

    // Surface variants
    surface: '#FFFFFF',
    subtle: '#F5F5F5',
  },

  dark: {
    text: '#EDEDED',
    tint: '#FFFFFF',

    background: '#09090B',
    foreground: '#EDEDED',

    card: '#121214',
    cardForeground: '#EDEDED',

    primary: '#FFFFFF',
    primaryForeground: '#000000',
    primaryHover: '#CCCCCC',
    primarySoft: '#1F1F23',

    secondary: '#1A1A1E',
    secondaryForeground: '#EDEDED',

    muted: '#1A1A1E',
    mutedForeground: '#525252',
    foregroundSoft: '#888888',

    accent: '#FFFFFF',
    accentForeground: '#000000',
    accentSoft: '#1F1F23',

    destructive: '#ef4444',
    destructiveForeground: '#FFFFFF',

    success: '#22c55e',
    successForeground: '#FFFFFF',

    border: '#202024',
    input: '#151517',

    surface: '#121214',
    subtle: '#0E0E10',
  },

  // Border radius (px) applied to cards, buttons, inputs, and modals.
  radius: 8,
};

export default colors;
