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

    // ─── Chat ──────────────────────────────────────────────────────────
    // Mirrors the web chat tokens in apps/web/app/globals.css so a message
    // looks identical on both clients.

    /** Elevated bubble surface for incoming messages (web `--color-surface-raised`). */
    surfaceRaised: '#F5F5F5',
    /** Outgoing bubble — web `--ds-blue-800`. */
    chatOwnBubble: '#0062D1',
    /**
     * Text on the outgoing blue bubble. Hard-coded white in both themes — the
     * web bubble overrides `--color-accent-foreground: white`, while our
     * `primaryForeground` flips to black in dark mode.
     */
    chatOwnBubbleForeground: '#FFFFFF',
    /** Outgoing bubble hover/pressed — web `--ds-blue-900`. */
    chatOwnBubblePressed: '#0068D6',
    /** Outgoing bubble tail — same as the bubble fill. */
    chatOwnBubbleTail: '#0062D1',
    /** Failed outgoing bubble — web `bg-red-500/80`. */
    chatFailedBubble: 'rgba(239, 68, 68, 0.8)',
    /** @mention text inside the sender's own blue bubble — web `--chat-mention-own`. */
    chatMentionOwn: '#99CEFF',
    /** @mention text on a normal bubble — web `--ds-blue-700`. */
    chatMention: '#0072F5',
    /** Neutral fallback for a sender name with no id — web `--color-foreground-muted`. */
    chatNameFallback: '#525252',
    /** Reply-quote block inside a bubble (web `bg-black/10` + `border-white/15`). */
    chatReplyBgOther: 'rgba(0, 0, 0, 0.06)',
    chatReplyBorderOther: '#DFDFDF',
    chatReplyBgOwn: 'rgba(0, 0, 0, 0.20)',
    chatReplyBorderOwn: 'rgba(255, 255, 255, 0.35)',
    /** Hard-coded dark reaction pill (web uses `bg-[#2a2a2a]` in both themes). */
    chatReactionPill: '#2A2A2A',
    /** Unread divider pill background. */
    chatUnreadPill: '#0062D1',
    /**
     * Rotating group-chat sender-name palette (web `--chat-name-0…6`), indexed
     * by a stable hash of the user id — see lib/chat.ts `userColorIndex`.
     * Keep in sync with USER_NAME_COLOR_COUNT.
     */
    chatNameColors: [
      '#0072F5', // blue-700
      '#0D8C7D', // teal-800
      '#8E4EC6', // purple-700
      '#EA3E83', // pink-700
      '#A35200', // amber-900
      '#398E4A', // green-800
      '#E5484D', // red-700
    ],
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

    // ─── Chat (dark) — mirrors globals.css dark block ──────────────────
    surfaceRaised: '#1B1B1F',
    chatOwnBubble: '#0062D1',
    chatOwnBubbleForeground: '#FFFFFF',
    chatOwnBubblePressed: '#0068D6',
    chatOwnBubbleTail: '#0062D1',
    chatFailedBubble: 'rgba(239, 68, 68, 0.8)',
    chatMentionOwn: '#52A8FF',
    chatMention: '#0072F5',
    chatNameFallback: '#737373',
    chatReplyBgOther: 'rgba(0, 0, 0, 0.10)',
    chatReplyBorderOther: 'rgba(255, 255, 255, 0.15)',
    chatReplyBgOwn: 'rgba(0, 0, 0, 0.20)',
    chatReplyBorderOwn: 'rgba(255, 255, 255, 0.20)',
    chatReactionPill: '#2A2A2A',
    chatUnreadPill: '#0062D1',
    chatNameColors: [
      '#52A8FF', // blue-900 (dark)
      '#0AC7B4', // teal-900
      '#BF7AF0', // purple-900
      '#F75F8F', // pink-900
      '#FFB224', // amber-700
      '#62C073', // green-900
      '#FF6166', // red-900
    ],
  },

  // Border radius (px) applied to cards, buttons, inputs, and modals.
  radius: 8,
};

export default colors;
