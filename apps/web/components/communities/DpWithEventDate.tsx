"use client";

import { eventDateBadge } from "@/lib/communities/event-date";

/**
 * A community display picture wearing the calendar badge for its event's date.
 *
 * An event's group chat wears the same face everywhere — the sidebar row, the
 * chat header, the event page's chat row — so the badge lives here rather than
 * being re-drawn at each site. It renders whatever DP it is given (the sidebar
 * and header use CommunityDp, the event panel AvatarImg) and adds the badge
 * only when there is a date to show, which keeps every other community's DP
 * exactly as it was.
 *
 * On the event's own day the tile says TODAY, and while the event is actually
 * running it says LIVE — one word deeper into "now" each time. Those words are
 * longer than any month abbreviation, so the today chip grows a little
 * (nothing reflows — the badge is absolutely positioned over the DP), both are
 * pinned to one fixed size so the two states read alike in every surface, and
 * the month alone is capped to the width the circle actually has. LIVE also
 * drops the page-coloured ring for the red one, so "on right now" reads even
 * at a glance across a full sidebar.
 */
const MONTH_RATIO = 0.28;
const DAY_RATIO = 0.45;
/** Readability floor: below this the month abbreviation stops being a word. */
const MIN_MONTH_PX = 6;
/** Advance width of one mono glyph relative to the font size, with tracking. */
const MONO_ADVANCE = 0.58;
/**
 * The TODAY and LIVE words are pinned to this size rather than scaling with
 * the badge, so the two "now" states read at one consistent size everywhere.
 */
const TODAY_FONT_PX = 5;

/** Badge diameter for a DP of this size — the same proportion in every surface. */
function badgeSizeFor(dpSize: number, isToday: boolean): number {
  return Math.round(dpSize * (isToday ? 0.7 : 0.6));
}

/**
 * The top line's size for a month abbreviation: the word is trimmed to the
 * circle's inner width rather than allowed to bleed through the ring. TODAY
 * and LIVE never go through here — they hold their own fixed size.
 */
function topLineFontSize(badgeSize: number, glyphs: number): number {
  const monthPx = Math.max(MIN_MONTH_PX, Math.round(badgeSize * MONTH_RATIO));
  // 2px of ring-adjacent breathing room on each side of the text.
  const fitsPx = Math.floor((badgeSize - 4) / (glyphs * MONO_ADVANCE));
  return Math.min(monthPx, fitsPx);
}

export function DpWithEventDate({
  date,
  endsAt,
  dpSize,
  className = "",
  children,
}: {
  /** The event's start, ISO. Absent/falsey → the DP renders on its own. */
  date?: string | null;
  /**
   * The event's end, ISO — what turns the tile red and says LIVE between start
   * and end. Callers hand over the sidebar's `pinned_until`, which is the
   * event's end for as long as the event could still be running.
   */
  endsAt?: string | null;
  /** Diameter of the DP inside, which the badge scales itself from. */
  dpSize: number;
  /** Extra classes for the wrapper (flex behaviour differs per surface). */
  className?: string;
  children: React.ReactNode;
}) {
  const badge = eventDateBadge(date, { endsAt });
  const badgeSize = badge ? badgeSizeFor(dpSize, badge.isToday) : 0;
  const word = badge ? (badge.isLive ? "Live" : badge.isToday ? "Today" : badge.month) : "";

  return (
    <div className={`relative shrink-0 ${className}`}>
      {children}

      {badge && (
        /* A wall-calendar tile: month over day, in the accent ink so it reads
           against any DP. Decorative for scanning, but the full date is in the
           accessible name and the tooltip, so the year the tile drops is still
           one hover (or screen reader) away — and on the day itself the tile
           trades the month for TODAY, or for LIVE while the event is under
           way, while the real date stays one hover away. */
        <span
          role="img"
          aria-label={
            badge.isLive
              ? `Event live now, ${badge.label}`
              : badge.isToday
                ? `Event today, ${badge.label}`
                : `Event on ${badge.label}`
          }
          title={badge.isLive ? `Live now · ${badge.label}` : badge.label}
          style={{
            width: badgeSize,
            height: badgeSize,
            fontSize:
              badge.isToday || badge.isLive
                ? TODAY_FONT_PX
                : topLineFontSize(badgeSize, word.length),
          }}
          className={`pointer-events-none absolute -bottom-1 -right-1 flex flex-col items-center justify-center rounded-full bg-accent font-mono font-bold uppercase leading-none tracking-tight text-accent-foreground ring-2 ${
            badge.isLive ? "ring-[var(--ds-red-700)]" : "ring-background"
          }`}
        >
          {word}
          <span
            className="mt-px font-display"
            style={{ fontSize: Math.round(badgeSize * DAY_RATIO) }}
          >
            {badge.day}
          </span>
        </span>
      )}
    </div>
  );
}
