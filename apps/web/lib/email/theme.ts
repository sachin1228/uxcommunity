import {
  darkTheme,
  fontFamily,
  fontSize,
  fontWeight,
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

/**
 * The email surface of the design system.
 *
 * Email has no cascade to lean on: Gmail strips `<style>` blocks, Outlook
 * desktop ignores `rem` and `box-shadow`, and no client resolves a CSS custom
 * property. So the palette, type scale and radii are read from the design
 * system at build time and inlined into the markup by the templates — the
 * source of truth stays the tokens, the output is plain inline CSS.
 *
 * Dark is the theme the product defaults to, and the trait that makes an email
 * recognisably ours, so it is the only theme the emails carry.
 */
export const emailTheme = {
  /** Page behind the card. */
  page: darkTheme.background,
  /** The card: `surfaceRaised`, the design system's panel tone. */
  card: darkTheme.surfaceRaised,
  /** Sunken wells inside the card — the one-time code. */
  well: darkTheme.background,
  heading: darkTheme.foreground,
  text: darkTheme.foregroundMuted,
  divider: darkTheme.border,
  accent: darkTheme.accent,
  accentText: darkTheme.accentForeground,
  /** A quiet action that must not compete with the primary button. */
  secondary: darkTheme.border,
  secondaryText: darkTheme.foreground,
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
