import {
  darkTheme,
  fontFamily,
  fontSize,
  fontWeight,
  lightTheme,
  lineHeight,
  radius,
} from "@uxcommunity/design-system";

/** Rewrite a design-system rem token as the px string email clients render. */
function px(rem: string): string {
  return `${Number.parseFloat(rem) * 16}px`;
}

/**
 * The design system's body stack with its leading `var(--font-display)` removed.
 *
 * Next.js injects that custom property into the page, and an email renders in a
 * document of its own where nothing defines it, so the whole stack after it
 * would be skipped. The remaining families are the design system's.
 */
const FONT_STACK = fontFamily.body.replace(/^var\(--font-display\),\s*/, "");

/** The colours that have to change when the reader's client asks for light or dark. */
export interface EmailPalette {
  /** Page behind the card. */
  page: string;
  /** The card: the design system's panel tone. */
  card: string;
  /** A sunken well inside the card — the one-time code. */
  well: string;
  heading: string;
  text: string;
  /** The one structural divider, above the footer. */
  divider: string;
  accent: string;
  accentText: string;
  /** A quiet action, in the border tone, for an ask that must not compete. */
  secondary: string;
  secondaryText: string;
}

/**
 * A design-system theme as the literal values email clients understand.
 *
 * The mapping is identical for both themes, so the two can only ever differ in
 * colour — there is no chance of light mode quietly changing a layout.
 */
function palette(theme: typeof lightTheme | typeof darkTheme): EmailPalette {
  return {
    page: theme.background,
    card: theme.surfaceRaised,
    well: theme.background,
    heading: theme.foreground,
    text: theme.foregroundMuted,
    divider: theme.border,
    accent: theme.accent,
    accentText: theme.accentForeground,
    secondary: theme.border,
    secondaryText: theme.foreground,
  };
}

/**
 * Both themes, resolved.
 *
 * Light is the one the markup inlines and dark is layered over it for clients
 * that honour `prefers-color-scheme` — the same arrangement as the design
 * system's own stylesheet, where light sits in `:root` and dark in a
 * media query. Light is also the safer base: a client that renders neither
 * (Outlook's Word engine discards the block entirely) still shows an email
 * designed for the white background it is going to paint anyway.
 */
export const emailPalettes = {
  light: palette(lightTheme),
  dark: palette(darkTheme),
} as const;

/**
 * The parts of an email that do not change with the theme: type and shape.
 *
 * Email has no cascade to lean on — no client resolves a CSS custom property,
 * Outlook's renderer ignores `rem`, and Gmail strips `<style>` blocks — so the
 * scale is read from the design system at build time and inlined as plain px.
 */
export const emailTheme = {
  font: FONT_STACK,
  size: {
    title: px(fontSize["2xl"]),
    body: px(fontSize.md),
    small: px(fontSize.sm),
    code: px(fontSize["3xl"]),
    wordmark: px(fontSize.lg),
  },
  weight: {
    semibold: fontWeight.semibold,
  },
  leading: {
    tight: lineHeight.tight,
    normal: lineHeight.normal,
    relaxed: lineHeight.relaxed,
  },
  radius: {
    card: radius.xl,
    well: radius.lg,
    button: radius.md,
  },
} as const;

export type EmailTheme = typeof emailTheme;
