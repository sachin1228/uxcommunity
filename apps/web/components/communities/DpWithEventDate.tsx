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
 * On the event's own day the tile says TODAY, while it runs it says LIVE,
 * and for a day after it wraps a small red ENDED pill sits on the DP's
 * corner — then that comes down too and the room reverts to a plain face,
 * the conversation itself untouched. The word states are pinned to one fixed
 * size (nothing reflows — the badge is absolutely positioned over the DP);
 * only the month abbreviation is fitted to the width the circle actually
 * has. LIVE takes the red ring so "on right now" reads at a glance; ENDED
 * trades the circle for a red word on the accent ink.
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
  // A day after the event the announcement has served its purpose and the DP
  // goes back to being just a DP — the room and its history stay. On the
  // event's own day the states read as one lifecycle: the date up top until
  // the day arrives, TODAY while it is still to come, LIVE while it runs,
  // ENDED once it wraps — each the most useful fact at that moment, so a
  // room whose event just finished never lingers on TODAY.
  const visible = Boolean(badge && (badge.isToday || badge.isLive || badge.isEnded));
  const isEnded = Boolean(badge?.isEnded);
  const badgeSize = visible && badge && !isEnded ? badgeSizeFor(dpSize, badge.isToday) : 0;
  const word = badge
    ? badge.isLive
      ? "Live"
      : isEnded
        ? "Ended"
        : badge.isToday
          ? "Today"
          : badge.month
    : "";

  return (
    <div className={`relative shrink-0 ${className}`}>
      {children}

      {isEnded && badge ? (
        /* Not a tile but a pill: the event is over, so the corner carries the
           word in red and lets the DP be a face again. The full date is in
           the accessible name and the tooltip, one hover away. */
        <span
          role="img"
          aria-label={`Event ended, ${badge.label}`}
          title={badge.label}
          className="pointer-events-none absolute -bottom-1.5 -right-1.5 rounded-full bg-accent px-1 py-px font-mono text-[5px] font-bold uppercase leading-none tracking-tight text-[var(--ds-red-700)] ring-1 ring-[var(--ds-red-700)]"
        >
          Ended
        </span>
      ) : visible && badge ? (
        /* A wall-calendar tile: month over day, in the accent ink so it reads
           against any DP. Decorative for scanning, but the full date is in the
           accessible name and the tooltip, so the year the tile drops is still
           one hover (or screen reader) away — and on the day itself the tile
           trades the month for TODAY or LIVE while the real date stays one
           hover away. */
        <span
          role="img"
          aria-label={badge.isLive ? `Event live now, ${badge.label}` : `Event today, ${badge.label}`}
          title={badge.isLive ? `Live now · ${badge.label}` : badge.label}
          style={{
            width: badgeSize,
            height: badgeSize,
            fontSize: badge.isToday || badge.isLive ? TODAY_FONT_PX : topLineFontSize(badgeSize, word.length),
          }}
          className={`pointer-events-none absolute -bottom-1 -right-1 flex flex-col items-center justify-center rounded-full font-mono font-bold uppercase leading-none tracking-tight ring-2 ${
            badge.isLive
              ? "bg-accent text-[var(--ds-red-700)] ring-[var(--ds-red-700)]"
              : "bg-accent text-accent-foreground ring-background"
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
      ) : null}
    </div>
  );
}
