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
 * the event's own day it trades the month for TODAY; while the event runs the
 * tile steps aside for a small LIVE pill — a pulsing dot and the word, no
 * date: on the day itself everyone can see it is today, and the open window
 * is the whole news. For an hour after the window closes the pill says ENDED
 * — no date either, the day has stopped being the news — and then it comes
 * down altogether and the room reverts to a plain face, the conversation
 * itself untouched. The red is the calendar's own ink rather than a state
 * signal — the same red, white and black in either theme and over any DP —
 * and the live pill alone carries the pulse, the beat that reads across a
 * sidebar while a window is open.
 *
 * The tile moves the way a date arrives: it springs in from the DP's corner
 * when it appears, and while the event is live a red ring pulses out of the
 * pill — the dot's beat at the pill's own scale — so the room happening right
 * now reads from further away than a word alone can. Both ride the DP's
 * corner, so the motion grows away from it, and both are plain CSS turned off
 * by the global reduce-motion guard, like every other entrance in the app.
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
 * The state pill's metrics (live and ended), as fractions of the DP: the
 * pill is sized by its content (dot, word, padding), so unlike the tile it
 * has no side of its own to scale from — everything rides the DP instead.
 * Height and dot are floored so the smallest sizes keep a pill that still
 * reads as one.
 */
const PILL_HEIGHT_RATIO = 0.42;
const PILL_FONT_RATIO = 0.22;
const PILL_DOT_RATIO = 0.15;
const PILL_GAP_RATIO = 0.06;
const PILL_PAD_RATIO = 0.14;
const MIN_PILL_HEIGHT_PX = 10;
const MIN_PILL_DOT_PX = 3;

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
 * tile's inner width rather than allowed to spill past the band. TODAY goes
 * through wordFontSize.
 */
function topLineFontSize(badgeSize: number, glyphs: number): number {
  const monthPx = Math.max(MIN_MONTH_PX, Math.round(badgeSize * MONTH_RATIO));
  // 2px of edge-adjacent breathing room on each side of the text.
  const fitsPx = Math.floor((badgeSize - 4) / (glyphs * MONO_ADVANCE));
  return Math.min(monthPx, fitsPx);
}

/**
 * TODAY's size: one proportion of the tile everywhere, trimmed to the tile's
 * inner width like the month is, so the word never reaches the band's edges.
 */
function wordFontSize(badgeSize: number, glyphs: number): number {
  const heightPx = Math.max(MIN_WORD_PX, Math.round(badgeSize * WORD_RATIO));
  // 2px of edge-adjacent breathing room on each side of the line.
  const fitsPx = Math.floor((badgeSize - 4) / (glyphs * MONO_ADVANCE));
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
   * The event's end, ISO — what turns the tile into the LIVE pill between
   * start and end (and ENDED for an hour after). Callers hand over the room's
   * `event_end` (the deadline whether it is ahead or past), falling back to
   * the sidebar's `pinned_until`, which is the same instant while the event
   * could still be running.
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
  // TODAY as the day arrives, steps aside for the state pill while the
  // window is open or freshly closed, and only comes down once there is
  // nothing left to announce — the room and its history stay. The gate is
  // "has the window closed and the grace hour passed", never the state
  // itself: an event weeks out must keep its plain date tile.
  const visible = Boolean(badge && (!badge.isPast || badge.isEnded));
  const isEnded = Boolean(badge?.isEnded);
  const isLive = Boolean(badge?.isLive);
  // While the window is the news — open, or just closed — the calendar steps
  // aside for the pill (see below); the tile itself only shows a plain date
  // or TODAY.
  const isPill = isLive || isEnded;
  const badgeSize = visible && badge && !isPill ? badgeSizeFor(dpSize, badge.isToday) : 0;
  const word = badge ? (badge.isToday ? "Today" : badge.month) : "";
  // One band line, two looks: TODAY scales as the word states do, the month
  // keeps its own proportion.
  const wordPx =
    visible && badge && !isPill
      ? badge.isToday
        ? wordFontSize(badgeSize, word.length)
        : topLineFontSize(badgeSize, word.length)
      : 0;
  const tileRadius = Math.max(3, Math.round(badgeSize * TILE_RADIUS_RATIO));
  // The state pill's metrics (see the pill's ratio block above).
  const pillHeight = Math.max(MIN_PILL_HEIGHT_PX, Math.round(dpSize * PILL_HEIGHT_RATIO));
  const pillFont = Math.round(dpSize * PILL_FONT_RATIO);
  const pillDot = Math.max(MIN_PILL_DOT_PX, Math.round(dpSize * PILL_DOT_RATIO));
  const pillGap = Math.max(1, Math.round(dpSize * PILL_GAP_RATIO));
  const pillPad = Math.max(3, Math.round(dpSize * PILL_PAD_RATIO));

  return (
    <div className={`relative shrink-0 ${className}`}>
      {children}

      {/* When the window is the news — open, or just closed — the calendar
          steps aside for a small pill. LIVE carries a dot's pulse and, with
          it, a ring pulsing out of the pill's shape; ENDED is the word
          alone. No date either way: the day it belongs to has stopped being
          the news. The anchor wraps pill and halo so the ring sizes itself
          to whatever the pill's content renders as. */}
      {visible && badge && isPill && (
        <span className="pointer-events-none absolute -bottom-1 -right-1">
          {isLive && (
            <span
              aria-hidden="true"
              className="event-tile-halo absolute inset-0 rounded-full border-2"
            />
          )}
          <span
            role="img"
            aria-label={isLive ? `Event live now, ${badge.label}` : `Event ended, ${badge.label}`}
            title={isLive ? `Live now · ${badge.label}` : badge.label}
            style={{
              height: pillHeight,
              fontSize: pillFont,
              gap: pillGap,
              paddingInline: pillPad,
            }}
            className="event-tile-in relative flex items-center rounded-full bg-[var(--ds-red-700)] font-mono font-bold uppercase leading-none tracking-tight text-white ring-2 ring-background"
          >
            {/* The live pulse, as a dot beside the word: one span swells and
                fades on repeat, the dot it leaves from holds steady inside
                it — the beat the word names, legible at a glance across a
                sidebar of rooms. Riding beside the word rather than filling
                the pill behind it keeps the pill readable while it moves,
                and the dot is sized off the DP so the swell stays its own
                mark instead of a wash over the pill. Members who asked for
                less motion keep the dot, without the swell. */}
            {isLive && (
              <span
                aria-hidden="true"
                className="relative inline-flex shrink-0"
                style={{ width: pillDot, height: pillDot }}
              >
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75 motion-reduce:animate-none" />
                <span className="relative inline-flex h-full w-full rounded-full bg-white" />
              </span>
            )}
            <span className="relative">{isLive ? "Live" : "Ended"}</span>
          </span>
        </span>
      )}

      {visible && badge && !isPill && (
        /* The tile: a wall calendar over the DP. The red name band carries
           the month or TODAY; the white leaf below carries the day in fixed
           ink — red, white and black are the calendar's own colours, so the
           tile reads the same in either theme and over any DP. It springs in
           from its anchored corner (see event-tile-in) whenever the room's
           face first appears. Decorative for scanning, but the full date is
           in the accessible name and the tooltip, so the year the tile drops
           is still one hover (or screen reader) away. */
        <span
          role="img"
          aria-label={badge.isToday ? `Event today, ${badge.label}` : `Event on ${badge.label}`}
          title={badge.label}
          style={{
            width: badgeSize,
            height: badgeSize,
            borderRadius: tileRadius,
          }}
          className="event-tile-in pointer-events-none absolute -bottom-1 -right-1 flex flex-col overflow-hidden border border-black/10 bg-white leading-none ring-2 ring-background"
        >
          <span
            className="flex shrink-0 items-center justify-center bg-[var(--ds-red-700)] font-mono font-bold uppercase tracking-tight text-white"
            style={{
              height: Math.round(badgeSize * BAND_RATIO),
              fontSize: wordPx,
            }}
          >
            {word}
          </span>
          {/* The day stays on the leaf — whenever the calendar is up, it is
              the calendar for the room's day. */}
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
