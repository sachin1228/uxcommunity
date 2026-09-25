"use client";

import { eventDateBadge } from "@/lib/communities/event-date";
import { useNowTick } from "./events/useNowTick";

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
 * and for a day after it wraps the circle says ENDED in red — the word
 * alone, no date — then the tile comes down and the room reverts to a plain
 * face, the conversation itself untouched. The word states are pinned to one
 * fixed size (nothing reflows — the badge is absolutely positioned over the
 * DP); only the month abbreviation is fitted to the width the circle
 * actually has. LIVE and ENDED take the red text and ring so "on right now"
 * and "just finished" read at a glance across a full sidebar, and LIVE drops
 * the day number for a pulse that runs while the window is open: the date the
 * room belongs to has stopped being the news at that point, and a heartbeat
 * reads across the sidebar the way a word can't.
 *
 * The badge reads the clock on its own tick (see EVENT_BADGE_TICK_MS), so the
 * states arrive and leave with the event's window rather than with the next
 * page load.
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

/**
 * How often the badge re-reads the clock. The circle announces a moment — a
 * window opening or closing — so it has to notice one arriving on its own:
 * every state it can wear is decided against "now", and a value captured at
 * render would keep saying LIVE long after the event ended. The tick is per
 * badge and cheap (no work unless the state actually changed), and a quarter
 * minute is close enough that a member watching the room sees the circle turn
 * without touching anything.
 */
const EVENT_BADGE_TICK_MS = 15_000;

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
   * and end. Callers hand over the room's `event_end` (the deadline whether it
   * is ahead or past), falling back to the sidebar's `pinned_until`, which is
   * the same instant while the event could still be running.
   */
  endsAt?: string | null;
  /** Diameter of the DP inside, which the badge scales itself from. */
  dpSize: number;
  /** Extra classes for the wrapper (flex behaviour differs per surface). */
  className?: string;
  children: React.ReactNode;
}) {
  const now = useNowTick(EVENT_BADGE_TICK_MS);
  const badge = eventDateBadge(date, { endsAt, now: new Date(now) });
  // The tile wears the date for every event still to come, trades it for
  // TODAY/LIVE as the day arrives, says ENDED for a day after the window
  // closes, and only then comes down — the room and its history stay. The
  // gate is "has the window closed and the grace day passed", never the
  // state itself: an event weeks out must keep its plain date circle.
  const visible = Boolean(badge && (!badge.isPast || badge.isEnded));
  const isEnded = Boolean(badge?.isEnded);
  // While the event is under way the tile is a word and a pulse, not a date:
  // the day it belongs to is no longer the useful fact (everyone can see it is
  // today), the window being open is — see the pulse below.
  const isLive = Boolean(badge?.isLive);
  const badgeSize = visible && badge ? badgeSizeFor(dpSize, badge.isToday || isEnded) : 0;
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

      {visible && badge && (
        /* A wall-calendar tile: month over day, in the accent ink so it reads
           against any DP. Decorative for scanning, but the full date is in the
           accessible name and the tooltip, so the year the tile drops is still
           one hover (or screen reader) away — and on the day itself the tile
           trades the month for TODAY, LIVE while the event is under way, or
           ENDED (red, no date) for the day after. */
        <span
          role="img"
          aria-label={
            badge.isLive
              ? `Event live now, ${badge.label}`
              : isEnded
                ? `Event ended, ${badge.label}`
                : badge.isToday
                  ? `Event today, ${badge.label}`
                  : `Event on ${badge.label}`
          }
          title={badge.isLive ? `Live now · ${badge.label}` : badge.label}
          style={{
            width: badgeSize,
            height: badgeSize,
            fontSize:
              badge.isToday || badge.isLive || isEnded
                ? TODAY_FONT_PX
                : topLineFontSize(badgeSize, word.length),
          }}
          className={`pointer-events-none absolute -bottom-1 -right-1 flex flex-col items-center justify-center overflow-hidden rounded-full font-mono font-bold uppercase leading-none tracking-tight ring-2 ${
            badge.isLive || isEnded
              ? "bg-accent text-[var(--ds-red-700)] ring-[var(--ds-red-700)]"
              : "bg-accent text-accent-foreground ring-background"
          }`}
        >
          {/* The live pulse: a red fill that swells and fades on repeat,
              clipped by the circle so it reads as the badge itself breathing
              rather than a halo bleeding over the DP behind it. Members who
              asked for less motion keep the word, without the movement. */}
          {isLive && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-full bg-[var(--ds-red-700)] opacity-40 animate-ping motion-reduce:animate-none"
            />
          )}
          <span className="relative">{word}</span>
          {!isEnded && !isLive && (
            <span
              className="relative mt-px font-display"
              style={{ fontSize: Math.round(badgeSize * DAY_RATIO) }}
            >
              {badge.day}
            </span>
          )}
        </span>
      )}
    </div>
  );
}
