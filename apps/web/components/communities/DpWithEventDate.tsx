"use client";

import { eventDateBadge } from "@/lib/communities/event-date";
import { useNowTick } from "@/lib/use-now-tick";

/**
 * A community display picture wearing the calendar tile for its event's date.
 *
 * An event's group chat wears the same face everywhere — the sidebar row, the
 * chat header, the event page's chat row — so the tile lives here rather than
 * being re-drawn at each site. It renders whatever DP it is given (the sidebar,
 * the chat header and the event panel all hand it a CommunityDp) and adds the
 * tile only when there is a date to show, which keeps every other community's
 * DP exactly as it was.
 *
 * The tile is a wall calendar — a red name band over a white leaf carrying the
 * day number — so the day a room is for reads the way a date reads off a
 * calendar, at every size the DP ships in. The band names the month, and on
 * the event's own day it trades the month for TODAY; while the event runs it
 * says LIVE beside a pulsing dot; and for a day after it wraps it says ENDED —
 * then the tile comes down and the room reverts to a plain face, the
 * conversation itself untouched. The leaf keeps its day number in every state,
 * LIVE included: the tile never stops being the calendar for that day, and
 * the band is where the news goes. The band's red is the calendar's own ink
 * rather than a state signal — the same red, white and black in either theme
 * and over any DP — and LIVE alone carries the pulse, the beat that reads
 * across a sidebar while a window is open.
 *
 * Every line scales with the tile and is fitted to the width the band actually
 * has (nothing reflows — the tile is absolutely positioned over the DP), so
 * the header's large one reads at the same weight as a sidebar row's small.
 *
 * The tile reads the clock on its own tick (see EVENT_BADGE_TICK_MS), so the
 * states arrive and leave with the event's window rather than with the next
 * page load.
 */
/** The red name band, as a fraction of the tile side. */
const BAND_RATIO = 0.38;
/** Corner radius, as a fraction of the tile side. */
const TILE_RADIUS_RATIO = 0.26;
const MONTH_RATIO = 0.23;
const DAY_RATIO = 0.45;
/** Readability floor: below this the month abbreviation stops being a word. */
const MIN_MONTH_PX = 6;
/** Advance width of one mono glyph relative to the font size, with tracking. */
const MONO_ADVANCE = 0.58;
/**
 * The word states' height, as a fraction of the tile — the same proportion
 * everywhere, so the header's large tile reads at the same weight as a
 * sidebar row's small one. Floored at the size the smallest tile ships with,
 * and still width-fitted (see wordFontSize) so the word cannot reach the
 * band's edges.
 */
const WORD_RATIO = 0.24;
const MIN_WORD_PX = 4;
/**
 * The live dot beside the word, as a fraction of the tile — big enough to
 * carry the pulse on a sidebar row, small enough to leave the word its room.
 * The gap follows it, and both are floored so a small tile keeps a dot that
 * is still a dot.
 */
const LIVE_DOT_RATIO = 0.22;
const MIN_LIVE_DOT_PX = 3;
const LIVE_DOT_GAP_RATIO = 0.08;

/**
 * How often the tile re-reads the clock. The tile announces a moment — a
 * window opening or closing — so it has to notice one arriving on its own:
 * every state it can wear is decided against "now", and a value captured at
 * render would keep saying LIVE long after the event ended. A quarter minute
 * is close enough that a member watching the room sees the tile turn without
 * touching anything, and the clock itself is shared with every other surface
 * that reads one (see use-now-tick), so the cadence costs a single timer.
 */
const EVENT_BADGE_TICK_MS = 15_000;

/** Badge side for a DP of this size — the same proportion in every surface. */
function badgeSizeFor(dpSize: number, isToday: boolean): number {
  return Math.round(dpSize * (isToday ? 0.7 : 0.6));
}

/**
 * The band line's size for a month abbreviation: the word is trimmed to the
 * tile's inner width rather than allowed to spill past the band. The word
 * states go through wordFontSize, which also reserves the pulse dot's width
 * for LIVE.
 */
function topLineFontSize(badgeSize: number, glyphs: number): number {
  const monthPx = Math.max(MIN_MONTH_PX, Math.round(badgeSize * MONTH_RATIO));
  // 2px of edge-adjacent breathing room on each side of the text.
  const fitsPx = Math.floor((badgeSize - 4) / (glyphs * MONO_ADVANCE));
  return Math.min(monthPx, fitsPx);
}

/**
 * The word states' size: one proportion of the tile everywhere, trimmed to
 * the tile's inner width like the month is. LIVE reserves the dot's width
 * (and the gap to the word) from that budget, so dot and word always fit as
 * one line and neither reaches the band's edges.
 */
function wordFontSize(badgeSize: number, glyphs: number, reservedPx = 0): number {
  const heightPx = Math.max(MIN_WORD_PX, Math.round(badgeSize * WORD_RATIO));
  // 2px of edge-adjacent breathing room on each side of the line.
  const fitsPx = Math.floor((badgeSize - 4 - reservedPx) / (glyphs * MONO_ADVANCE));
  return Math.min(heightPx, Math.max(MIN_WORD_PX, fitsPx));
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
   * The event's end, ISO — what turns the band's story to LIVE between start
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
  // state itself: an event weeks out must keep its plain date tile.
  const visible = Boolean(badge && (!badge.isPast || badge.isEnded));
  const isEnded = Boolean(badge?.isEnded);
  // While the event is under way the band swaps the month for LIVE and a
  // pulse: the day it belongs to is no longer the useful fact (everyone can
  // see it is today), the window being open is — see the pulse below.
  const isLive = Boolean(badge?.isLive);
  const badgeSize = visible && badge ? badgeSizeFor(dpSize, badge.isToday || isEnded) : 0;
  const liveDotSize = Math.max(MIN_LIVE_DOT_PX, Math.round(badgeSize * LIVE_DOT_RATIO));
  const liveDotGap = Math.max(1, Math.round(badgeSize * LIVE_DOT_GAP_RATIO));
  const word = badge
    ? badge.isLive
      ? "Live"
      : isEnded
        ? "Ended"
        : badge.isToday
          ? "Today"
          : badge.month
    : "";
  // One band line, three looks: the word states scale as their own proportion
  // (LIVE reserving room for the dot beside it), the month keeps its own.
  const wordPx =
    visible && badge
      ? badge.isToday || badge.isLive || isEnded
        ? wordFontSize(badgeSize, word.length, isLive ? liveDotSize + liveDotGap : 0)
        : topLineFontSize(badgeSize, word.length)
      : 0;

  return (
    <div className={`relative shrink-0 ${className}`}>
      {children}

      {visible && badge && (
        /* The tile: a wall calendar over the DP. The red name band carries
           the month, the state word, and LIVE's pulse; the white leaf below
           carries the day in fixed ink — red, white and black are the
           calendar's own colours, so the tile reads the same in either theme
           and over any DP. Decorative for scanning, but the full date is in
           the accessible name and the tooltip, so the year the tile drops is
           still one hover (or screen reader) away. */
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
            borderRadius: Math.max(3, Math.round(badgeSize * TILE_RADIUS_RATIO)),
          }}
          className="pointer-events-none absolute -bottom-1 -right-1 flex flex-col overflow-hidden border border-black/10 bg-white leading-none ring-2 ring-background"
        >
          <span
            className="flex shrink-0 items-center justify-center bg-[var(--ds-red-700)] font-mono font-bold uppercase tracking-tight text-white"
            style={{
              height: Math.round(badgeSize * BAND_RATIO),
              fontSize: wordPx,
            }}
          >
            {/* The live pulse, as a dot beside the word: one span swells and
                fades on repeat, the dot it leaves from holds steady inside it —
                the beat the word names, legible at a glance across a sidebar of
                rooms. Riding beside the word rather than filling the band
                behind it keeps the tile readable while it moves, and the dot is
                sized off the tile so the swell stays its own mark instead of a
                wash over the band. Members who asked for less motion keep the
                dot, without the swell. */}
            {isLive ? (
              <span className="relative flex items-center" style={{ gap: liveDotGap }}>
                <span
                  aria-hidden="true"
                  className="relative inline-flex shrink-0"
                  style={{ width: liveDotSize, height: liveDotSize }}
                >
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75 motion-reduce:animate-none" />
                  <span className="relative inline-flex h-full w-full rounded-full bg-white" />
                </span>
                <span className="relative">{word}</span>
              </span>
            ) : (
              <span className="relative">{word}</span>
            )}
          </span>
          {/* The day stays on the leaf in every state — the tile is still the
              calendar for the room's day, it is only the band that changes its
              story. */}
          <span
            className="flex flex-1 items-center justify-center font-display font-bold tracking-tight text-black"
            style={{ fontSize: Math.round(badgeSize * DAY_RATIO) }}
          >
            {badge.day}
          </span>
        </span>
      )}
    </div>
  );
}
