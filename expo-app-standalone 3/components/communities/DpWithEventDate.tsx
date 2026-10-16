import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useNowTick } from '@/hooks/useNowTick';
import { eventDateBadge } from '@/lib/eventDate';

/**
 * A community display picture wearing the calendar tile for its event's date —
 * a React Native port of the web app's `DpWithEventDate.tsx`.
 *
 * An event's group chat wears the same face everywhere — the communities list
 * row, the chat header — so the tile lives here rather than being re-drawn at
 * each site. It renders whatever DP it is given and adds the tile only when
 * there is a date to show, which keeps every other community's DP exactly as
 * it was.
 *
 * The tile is a wall calendar — a red name band over a white leaf carrying the
 * day number. The band names the month, and on the event's own day it trades
 * the month for TODAY; while the event runs the tile steps aside for a small
 * LIVE pill — a pulsing dot and the word, no date — centered on the DP's
 * bottom edge. For half a day after the window closes the pill says ENDED, and
 * then it comes down altogether and the room reverts to a plain face (see
 * `lib/eventDate.ts`). Red, white and black are the calendar's own colours, so
 * the tile reads the same in either theme and over any DP.
 *
 * The tile reads the shared clock (see `useNowTick`), so the states arrive and
 * leave with the event's window rather than with the next screen load.
 */

/** The red name band, as a fraction of the tile side. */
const BAND_RATIO = 0.38;
/** Corner radius, as a fraction of the tile side. */
const TILE_RADIUS_RATIO = 0.26;
const MONTH_RATIO = 0.23;
const DAY_RATIO = 0.45;
/** Readability floor: below this the month abbreviation stops being a word. */
const MIN_MONTH_PX = 6;
/** Advance width of one glyph relative to the font size, with tracking. */
const MONO_ADVANCE = 0.58;
/** The word states' height, as a fraction of the tile. */
const WORD_RATIO = 0.24;
const MIN_WORD_PX = 4;
/** The state pill's metrics, as fractions of the DP (see the web ratios). */
const PILL_HEIGHT_RATIO = 0.42;
const PILL_FONT_RATIO = 0.22;
const PILL_DOT_RATIO = 0.15;
const PILL_GAP_RATIO = 0.06;
const PILL_PAD_RATIO = 0.14;
const MIN_PILL_HEIGHT_PX = 10;
const MIN_PILL_DOT_PX = 3;

/** Fixed calendar ink — no theme tokens on the tile itself (web parity). */
const CALENDAR_RED = '#e5484d';
const CALENDAR_LEAF = '#FFFFFF';
const CALENDAR_BAND_TEXT = '#FFFFFF';
const CALENDAR_DAY_TEXT = '#000000';

/** Badge side for a DP of this size — the same proportion in every surface. */
function badgeSizeFor(dpSize: number, isToday: boolean): number {
  return Math.round(dpSize * (isToday ? 0.7 : 0.6));
}

/** The band line's size for a month abbreviation, trimmed to the band width. */
function topLineFontSize(badgeSize: number, glyphs: number): number {
  const monthPx = Math.max(MIN_MONTH_PX, Math.round(badgeSize * MONTH_RATIO));
  const fitsPx = Math.floor((badgeSize - 4) / (glyphs * MONO_ADVANCE));
  return Math.min(monthPx, fitsPx);
}

/** TODAY's size — one proportion of the tile everywhere, width-fitted. */
function wordFontSize(badgeSize: number, glyphs: number): number {
  const heightPx = Math.max(MIN_WORD_PX, Math.round(badgeSize * WORD_RATIO));
  const fitsPx = Math.floor((badgeSize - 4) / (glyphs * MONO_ADVANCE));
  return Math.min(heightPx, Math.max(MIN_WORD_PX, fitsPx));
}

/** The live pulse: one dot swells and fades on repeat (like TypingDots). */
function LiveDot({ size }: { size: number }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={{ width: size, height: size }}>
      <Animated.View
        style={[
          styles.liveDot,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.75, 0] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
          },
        ]}
      />
      <View
        style={[styles.liveDot, { width: size, height: size, borderRadius: size / 2 }]}
      />
    </View>
  );
}

export function DpWithEventDate({
  date,
  endsAt,
  dpSize,
  children,
  style,
}: {
  /** The event's start, ISO. Absent/falsey → the DP renders on its own. */
  date?: string | null;
  /**
   * The event's end, ISO — what turns the tile into the LIVE pill between
   * start and end (and ENDED for half a day after). Callers hand over the
   * room's `event_end` falling back to the sidebar's `pinned_until`, which is
   * the same instant while the event could still be running.
   */
  endsAt?: string | null;
  /** Diameter of the DP inside, which the badge scales itself from. */
  dpSize: number;
  /** Extra styles for the wrapper (flex behaviour differs per surface). */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const now = useNowTick();
  const badge = eventDateBadge(date, { endsAt, now: new Date(now) });
  // The tile wears the date for every event still to come, trades it for
  // TODAY as the day arrives, steps aside for the state pill while the window
  // is open or freshly closed, and only comes down once there is nothing left
  // to announce. The gate is "has the window closed and the ended grace
  // passed", never the state itself: an event weeks out keeps its date tile.
  const visible = Boolean(badge && (!badge.isPast || badge.isEnded));
  const isEnded = Boolean(badge?.isEnded);
  const isLive = Boolean(badge?.isLive);
  const isPill = isLive || isEnded;
  const badgeSize = visible && badge && !isPill ? badgeSizeFor(dpSize, badge.isToday) : 0;
  const word = badge ? (badge.isToday ? 'TODAY' : badge.month) : '';
  const wordPx =
    visible && badge && !isPill
      ? badge.isToday
        ? wordFontSize(badgeSize, word.length)
        : topLineFontSize(badgeSize, word.length)
      : 0;
  const tileRadius = Math.max(3, Math.round(badgeSize * TILE_RADIUS_RATIO));

  const pillHeight = Math.max(MIN_PILL_HEIGHT_PX, Math.round(dpSize * PILL_HEIGHT_RATIO));
  const pillFont = Math.round(dpSize * PILL_FONT_RATIO);
  const pillDot = Math.max(MIN_PILL_DOT_PX, Math.round(dpSize * PILL_DOT_RATIO));
  const pillGap = Math.max(1, Math.round(dpSize * PILL_GAP_RATIO));
  const pillPad = Math.max(3, Math.round(dpSize * PILL_PAD_RATIO));

  return (
    <View style={[styles.wrap, style]}>
      {children}

      {/* While the window is the news — open, or just closed — the calendar
          steps aside for a small pill centered on the DP's bottom edge: LIVE
          carries a dot's pulse, ENDED is the word alone. No date either way:
          the day it belongs to has stopped being the news. */}
      {visible && badge && isPill && (
        <View style={styles.pillAnchor} pointerEvents="none">
          <View style={[styles.pillRing, { borderRadius: (pillHeight + 4) / 2, borderColor: colors.background }]}>
            <View
              accessible
              accessibilityRole="image"
              accessibilityLabel={
                isLive ? `Event live now, ${badge.label}` : `Event ended, ${badge.label}`
              }
              style={[
                styles.pill,
                {
                  height: pillHeight,
                  borderRadius: pillHeight / 2,
                  paddingHorizontal: pillPad,
                  gap: pillGap,
                },
              ]}
            >
              {isLive && <LiveDot size={pillDot} />}
              <Text style={[styles.pillText, { fontSize: pillFont }]}>
                {isLive ? 'LIVE' : 'ENDED'}
              </Text>
            </View>
          </View>
        </View>
      )}

      {visible && badge && !isPill && (
        /* The tile: a wall calendar over the DP. The red name band carries
           the month or TODAY; the white leaf below carries the day in fixed
           ink. The full date is in the accessible name, so the year the tile
           drops is still one (screen reader) away. */
        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={
            badge.isToday ? `Event today, ${badge.label}` : `Event on ${badge.label}`
          }
          style={[
            styles.tileRing,
            { borderRadius: tileRadius + 2, borderColor: colors.background },
          ]}
          pointerEvents="none"
        >
          <View
            style={[
              styles.tile,
              {
                width: badgeSize,
                height: badgeSize,
                borderRadius: tileRadius,
              },
            ]}
          >
            <View
              style={[styles.tileBand, { height: Math.round(badgeSize * BAND_RATIO) }]}
            >
              <Text style={[styles.tileBandText, { fontSize: wordPx }]} numberOfLines={1}>
                {word}
              </Text>
            </View>
            <View style={styles.tileLeaf}>
              <Text
                style={[styles.tileDayText, { fontSize: Math.round(badgeSize * DAY_RATIO) }]}
                numberOfLines={1}
              >
                {badge.day}
              </Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'relative',
    flexShrink: 0,
  },
  // The pill is anchored to the bottom edge, horizontally centered (the web
  // `left-1/2 -translate-x-1/2`).
  pillAnchor: {
    position: 'absolute',
    bottom: -4,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  // The ring separates the pill from whatever DP is under it (web
  // `ring-2 ring-background`).
  pillRing: {
    borderWidth: 2,
    backgroundColor: 'transparent',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CALENDAR_RED,
  },
  pillText: {
    color: CALENDAR_BAND_TEXT,
    fontFamily: 'Geist_700Bold',
    letterSpacing: -0.3,
  },
  liveDot: {
    position: 'absolute',
    backgroundColor: CALENDAR_BAND_TEXT,
  },
  // The tile overhangs the DP's bottom-right corner (web `-bottom-1 -right-1`).
  tileRing: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    borderWidth: 2,
  },
  tile: {
    backgroundColor: CALENDAR_LEAF,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0, 0, 0, 0.1)',
  },
  tileBand: {
    backgroundColor: CALENDAR_RED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBandText: {
    color: CALENDAR_BAND_TEXT,
    fontFamily: 'Geist_700Bold',
    letterSpacing: -0.3,
  },
  tileLeaf: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileDayText: {
    color: CALENDAR_DAY_TEXT,
    fontFamily: 'Geist_700Bold',
    letterSpacing: -0.5,
  },
});
