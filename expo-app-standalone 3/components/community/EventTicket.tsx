import React, { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { Circle, Line, Path, Svg } from 'react-native-svg';
import { PersonAvatar } from '@/components/PersonAvatar';
import { formatEventDate } from '@/lib/eventDate';
import { formatEventTimeRange, hostScheduleForViewer } from '@/lib/eventDisplay';
import type { CommunityEvent } from '@/lib/communityContent';
import type { EventJoinAnswers } from '@/lib/eventJoinQuestions';
import { hapticToggle } from '@/lib/haptics';
import { EventJoinQuestionsModal } from './EventJoinQuestionsModal';
import { RsvpConfirmDialog, type RsvpConfirmMode } from './RsvpConfirmDialog';

/**
 * The event ticket — a port of the web `EventCard`'s ticket body: poster,
 * title and schedule rows, the going strip, then the accent-tinted stub with
 * the big date and the RSVP call to action. On a phone the web card stacks
 * these three panels vertically (its sub-`lg` layout), so this one does too.
 *
 * The stacked layout still reads as a ticket, so the perforation is drawn
 * across the body/stub seam: the web's dashed line between the tangent points
 * and the semicircular cut-outs at both edges, with the ticket border carried
 * round the half of each cut-out that bites into the paper. The web clips those
 * out of the paper; here they are punched with the colour of whatever surface
 * the ticket sits on, which is why `notchColor` comes from the caller.
 *
 * The card keeps the web's fixed dark paper and prints its own colors: the
 * ticket is deliberately the same black in both themes, and the accent color
 * the host picked is the only hue on it.
 *
 * The stub's button is not a bare toggle. Going and not-going each open or
 * close the event's group chat, so a tap only asks — the dialog that answers
 * shows the room it is about — and joining the room goes through the host's
 * compulsory questions first.
 *
 * It also hangs. The tilt and the depth are the resting state; every so often
 * something nudges the ticket and it swings through a few decaying passes back
 * to exactly that tilt, then rests until the next one. A narrow glint crosses
 * the paper on its own slower beat. All of it runs on the native driver, and
 * none of it runs when the phone asks for reduced motion.
 */

const ACCENT_FALLBACK = '#e8e14a';
const TICKET_BG = '#111111';
const TICKET_BORDER = 1.5;
const TICKET_BORDER_COLOR = 'rgba(255,255,255,0.16)';
const NOTCH_R = 13;
const SEAM_STROKE = 'rgba(255,255,255,0.22)';
/** The whole going-count tick: face in, then the number. */
const TICK_MS = 460;
/**
 * The hang's swing: degrees off the rest tilt, and how long each pass takes.
 * Decaying passes, the last one landing back on 0 — the ticket returns to
 * precisely the angle it started from and holds there for `SWING_REST_MS`.
 */
const SWING: Array<[number, number]> = [
  [1.6, 620],
  [-1.25, 560],
  [0.9, 520],
  [-0.55, 480],
  [0.28, 440],
  [0, 420],
];
/** How still the ticket sits between two swings. */
const SWING_REST_MS = 5000;
/** The glint takes this long across the paper, then waits out the cycle. */
const SHINE_MS = 1000;
const SHINE_REST_MS = 19000;
/** The lit band's width in dp — a glint, not a wash over the paper. */
const SHINE_BAND = 12;
const STONE_50 = '#fafaf9';
const STONE_200 = '#e7e5e4';
const STONE_300 = '#d6d3d1';
const STONE_400 = '#a8a29e';
const STONE_500 = '#78716c';

const POSTER_GRADIENTS: Array<[string, string]> = [
  ['rgba(139,92,246,0.8)', 'rgba(236,72,153,0.8)'],
  ['rgba(59,130,246,0.8)', 'rgba(34,211,238,0.8)'],
  ['rgba(251,146,60,0.8)', 'rgba(244,63,94,0.8)'],
  ['rgba(52,211,153,0.8)', 'rgba(20,184,166,0.8)'],
];

/**
 * True when an accent is so light that white text would wash out (the web's
 * `accentNeedsDarkText`, WCAG relative luminance > 0.8).
 */
function accentNeedsDarkText(hex: string): boolean {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return false;
  const channel = (index: number) => {
    const value = parseInt(match[1].slice(index, index + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
  return luminance > 0.8;
}

/**
 * One leg of the swing: turn the layer to `to` degrees over `ms`. A pass between
 * two extremes is quickest through the middle, which is what inOut gives; the
 * decay lives in the amplitudes, not in one curve.
 */
function turn(value: Animated.Value, to: number, ms: number, easing = Easing.inOut(Easing.quad)) {
  return Animated.timing(value, {
    toValue: to,
    duration: ms,
    easing,
    useNativeDriver: true,
  });
}

/** The hang's value is degrees; a transform wants it labelled as such. */
function deg(value: Animated.Value) {
  return value.interpolate({ inputRange: [-3, 3], outputRange: ['-3deg', '3deg'] });
}

interface EventTicketProps {
  event: CommunityEvent;
  goingCount: number;
  rsvped: boolean;
  /**
   * Send the RSVP — the host's answers ride with it when the questions dialog
   * collected them. Resolves when the server has agreed and rejects with the
   * reason, which the open dialog shows.
   */
  onRsvp: (answers: EventJoinAnswers | null) => Promise<void>;
  /** The community the event belongs to, named in the questions' intro. */
  communityName?: string | null;
  /** Whether the viewer hosts this event — the room outlives their RSVP. */
  isOwner?: boolean;
  /** The surface behind the ticket, used to punch the notch cut-outs. */
  notchColor: string;
  /** Feed cards clamp the title; the event page lets it wrap in full. */
  variant?: 'card' | 'detail';
}

export function EventTicket({
  event,
  goingCount,
  rsvped,
  onRsvp,
  communityName = null,
  isOwner = false,
  notchColor,
  variant = 'card',
}: EventTicketProps) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(event.accent_color ?? '')
    ? (event.accent_color as string).toLowerCase()
    : ACCENT_FALLBACK;
  const onAccentInk = accentNeedsDarkText(accent) ? '#0c0a09' : '#ffffff';
  const start = new Date(event.event_date);
  const weekday = start.toLocaleString('en-IN', { weekday: 'short' }).toUpperCase();
  const month = start.toLocaleString('en-IN', { month: 'short' }).toUpperCase();
  const year = String(start.getFullYear());
  const dateLabel = formatEventDate(event.event_date);
  const timeRange = formatEventTimeRange(event.event_date, event.end_date);
  const hostSchedule = hostScheduleForViewer(event);
  const count = Math.max(0, goingCount);
  const past = new Date(event.end_date ?? event.event_date).getTime() < Date.now();
  const full = event.max_attendees !== null && count >= event.max_attendees && !rsvped;
  const spotsLeft = event.max_attendees !== null ? event.max_attendees - count : null;

  const [posterRatio, setPosterRatio] = useState<number | null>(null);
  useEffect(() => setPosterRatio(null), [event.cover_image_url]);

  // The perforation is drawn over the seam between the body and the stub, so
  // it needs that seam's y and the ticket's outer width. Both land after the
  // first layout pass; the overlay simply appears one frame later.
  const [seam, setSeam] = useState<{ width: number; y: number } | null>(null);

  // Going and not-going both open the event's group chat or close it, so the
  // button asks first — the web card's rule. Joining answers the host's
  // questions on the way, and only the dialog's own button sends. A failure
  // leaves the dialog up with the reason, so nothing the member typed is lost.
  const [confirm, setConfirm] = useState<RsvpConfirmMode | null>(null);
  const [questionsOpen, setQuestionsOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const commit = async (answers: EventJoinAnswers | null = null) => {
    hapticToggle(!rsvped);
    setPending(true);
    setError(null);
    try {
      await onRsvp(answers);
      setConfirm(null);
      setQuestionsOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't update your RSVP.");
    } finally {
      setPending(false);
    }
  };

  // The going-count tick: when an RSVP lands, the newest face tucks into the
  // strip and the number rolls up a beat behind it. `landed` is the state the
  // strip was last drawn for; a bump reads from the render pass that shows it
  // and is retired only once the tick has run.
  const attendees = (event.rsvps ?? []).slice(0, 5);
  const landed = useRef({ count, attendees: attendees.length });
  const countUp = count > landed.current.count;
  const faceIn = attendees.length > landed.current.attendees;
  const ticked = countUp || faceIn;
  const tick = useRef(new Animated.Value(1)).current;
  const reduceMotion = useRef(false);
  const [motion, setMotion] = useState(false);

  // The hang: one swing through decaying passes, back to the rest tilt, then
  // five seconds of nothing before the next. The shine rides its own value and
  // is off the paper between sweeps.
  const swing = useRef(new Animated.Value(0)).current;
  const shine = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        reduceMotion.current = enabled;
        setMotion(!enabled);
      })
      .catch(() => { setMotion(true); /* assume motion is fine */ });
  }, []);

  useEffect(() => {
    if (!motion) return undefined;
    const [first, ...rest] = SWING;
    const swingLoop = Animated.loop(
      Animated.sequence([
        // Pushed from stillness, so the first pass decelerates into its extreme;
        // every pass after it crosses the middle at speed, which is inOut.
        turn(swing, first[0], first[1], Easing.out(Easing.quad)),
        ...rest.map(([to, ms]) => turn(swing, to, ms)),
        Animated.delay(SWING_REST_MS),
      ]),
    );
    const shineLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(shine, {
          toValue: 1,
          duration: SHINE_MS,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.delay(SHINE_REST_MS),
        // The band sits off the ticket at both ends, so the reset is invisible.
        Animated.timing(shine, { toValue: 0, duration: 1, useNativeDriver: true }),
      ]),
    );
    const loops = [swingLoop, shineLoop];
    loops.forEach((loop) => { loop.start(); });
    return () => { loops.forEach((loop) => { loop.stop(); }); };
  }, [motion, swing, shine]);

  useEffect(() => {
    const snapshot = { count, attendees: attendees.length };
    // A render with no bump retires the baseline too, otherwise a 1 → 0 → 1
    // round trip keeps comparing against the stale 1 and never ticks.
    if (!ticked || reduceMotion.current) {
      landed.current = snapshot;
      return;
    }
    tick.setValue(0);
    Animated.timing(tick, {
      toValue: 1,
      duration: TICK_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => { landed.current = snapshot; });
  }, [ticked, count, attendees.length, tick]);

  // One travelling value carries both beats. `Animated.timing`'s delay is
  // dropped by the native driver, so the stagger lives in the ranges: the face
  // is home by 55% of the tick, the number only starts moving at 30%.
  const newFaceStyle = {
    opacity: tick.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0, 1, 1] }),
    transform: [{
      translateX: tick.interpolate({ inputRange: [0, 0.55, 1], outputRange: [16, 0, 0] }),
    }],
  };
  const rollingNumberStyle = {
    opacity: tick.interpolate({ inputRange: [0, 0.3, 0.9, 1], outputRange: [0, 0, 1, 1] }),
    transform: [{
      translateY: tick.interpolate({ inputRange: [0, 0.3, 0.9, 1], outputRange: [9, 9, 0, 0] }),
    }],
  };

  const gradient =
    POSTER_GRADIENTS[(event.id.charCodeAt(0) || 0) % POSTER_GRADIENTS.length];

  return (
    <>
    <Animated.View
      // No rest tilt: the ticket hangs plumb, and the swing is a departure from
      // plumb that always comes back to it. One pivot, just under the top edge.
      style={[styles.frame, { transform: [{ rotate: deg(swing) }] }]}
      onLayout={(layout) => {
        const width = layout.nativeEvent.layout.width;
        setSeam((current) => ({ width, y: current?.y ?? 0 }));
      }}
    >
      <View style={styles.ticket}>
        {/* Panel 1 — the poster, inset like a mounted print. */}
        <View style={styles.posterPanel}>
          <View style={styles.posterWrap}>
            {event.cover_image_url ? (
              <Image
                source={{ uri: event.cover_image_url }}
                style={[styles.poster, posterRatio ? { aspectRatio: posterRatio } : styles.posterFallback]}
                contentFit="cover"
                onLoad={(load) => {
                  const width = load.source?.width ?? 0;
                  const height = load.source?.height ?? 0;
                  if (width > 0 && height > 0) setPosterRatio(width / height);
                }}
                accessibilityLabel={event.title}
              />
            ) : (
              <LinearGradient
                colors={gradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.posterFallback}
              />
            )}
            {event.location ? (
              <LinearGradient
                colors={['rgba(0,0,0,0.85)', 'transparent']}
                start={{ x: 0.5, y: 1 }}
                end={{ x: 0.5, y: 0 }}
                style={styles.locationCaption}
                pointerEvents="none"
              >
                <Feather name="map-pin" size={14} color="#ffffff" />
                <Text style={styles.locationText} numberOfLines={1}>
                  {event.location}
                </Text>
              </LinearGradient>
            ) : null}
          </View>
        </View>

        {/* Panel 2 — title and schedule. */}
        <View
          style={styles.body}
          onLayout={(layout) => {
            const { y, height } = layout.nativeEvent.layout;
            // Yoga reports the body's y from the ticket's border-box origin, so
            // this bottom edge already is the seam — adding the border again
            // drops the dash below the body/stub boundary.
            setSeam((current) => ({ width: current?.width ?? 0, y: y + height }));
          }}
        >
          <Text style={styles.title} numberOfLines={variant === 'card' ? 2 : undefined}>
            {event.title}
          </Text>

          <View style={styles.meta}>
            {dateLabel ? (
              <View style={styles.metaRow}>
                <Feather name="calendar" size={13} color={STONE_400} />
                <Text style={styles.metaText}>{dateLabel}</Text>
              </View>
            ) : null}
            {timeRange ? (
              <View style={styles.metaRow}>
                <Feather name="clock" size={13} color={STONE_400} />
                <Text style={styles.metaText}>{timeRange}</Text>
              </View>
            ) : null}
            {hostSchedule ? (
              <Text style={styles.hostTime}>
                Host time: {hostSchedule.range} ({hostSchedule.zone})
              </Text>
            ) : null}
            {event.is_online ? (
              event.meet_link ? (
                <Pressable
                  onPress={() => { void Linking.openURL(event.meet_link as string); }}
                  style={styles.metaRow}
                  accessibilityRole="link"
                  accessibilityLabel="Open meeting link"
                >
                  <Feather name="video" size={13} color={STONE_400} />
                  <Text style={[styles.metaText, styles.metaLink]}>Online (Google Meet)</Text>
                </Pressable>
              ) : (
                <View style={styles.metaRow}>
                  <Feather name="video" size={13} color={STONE_400} />
                  <Text style={styles.metaText}>Online</Text>
                </View>
              )
            ) : event.location ? (
              <View style={styles.metaRow}>
                <Feather name="map-pin" size={13} color={STONE_400} />
                <Text style={styles.metaText} numberOfLines={1}>{event.location}</Text>
              </View>
            ) : null}
            {spotsLeft !== null ? (
              <View style={styles.metaRow}>
                <Feather name="users" size={13} color={STONE_400} />
                <Text style={[styles.metaText, spotsLeft <= 0 ? styles.metaSpent : null]}>
                  {spotsLeft > 0 ? `${spotsLeft} spots remaining` : 'No spots remaining'}
                </Text>
              </View>
            ) : null}
          </View>

          {count > 0 ? (
            <View style={styles.goingRow}>
              {attendees.length ? (
                <View style={styles.avatarStrip}>
                  {attendees.map((rsvp, index) => {
                    const key = rsvp.user_id || `attendee-${index}`;
                    const overlap = index === 0 ? 0 : -8;
                    // Only the face that just arrived travels. Its negative
                    // margin moves onto the wrapper so the sliding disc still
                    // tucks under its neighbour.
                    const isNewFace = faceIn && index === attendees.length - 1;
                    const avatar = (
                      <PersonAvatar
                        name={rsvp.users?.name}
                        url={rsvp.users?.avatar_url}
                        size={28}
                        style={{
                          zIndex: 10 - index,
                          marginLeft: isNewFace ? 0 : overlap,
                          borderWidth: 2,
                          borderColor: TICKET_BG,
                        }}
                      />
                    );
                    if (!isNewFace) return <React.Fragment key={key}>{avatar}</React.Fragment>;
                    return (
                      <Animated.View
                        key={key}
                        style={[{ zIndex: 10 - index, marginLeft: overlap }, newFaceStyle]}
                      >
                        {avatar}
                      </Animated.View>
                    );
                  })}
                </View>
              ) : null}
              <View style={styles.goingLabel}>
                <Animated.View style={rollingNumberStyle}>
                  <Text style={styles.goingText}>{count}</Text>
                </Animated.View>
                <Text style={[styles.goingText, styles.goingWords]}>
                  {count === 1 ? 'person' : 'people'} going
                </Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* Panel 3 — the stub: date block and the RSVP call to action. */}
        <LinearGradient
          colors={[`${accent}1f`, 'transparent']}
          locations={[0, 0.7]}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={styles.stub}
        >
          <View style={styles.dateBlock}>
            <Text style={styles.stubWeekday}>{weekday}</Text>
            <Text style={[styles.stubDay, { color: accent }]}>{start.getDate()}</Text>
            <Text style={styles.stubMonth}>
              {month} {year}
            </Text>
          </View>

          {!past ? (
            <Pressable
              onPress={() => {
                if (pending) return;
                setError(null);
                setConfirm(rsvped ? 'leave' : 'join');
              }}
              disabled={full}
              style={[
                styles.rsvpButton,
                rsvped
                  ? { backgroundColor: `${accent}33` }
                  : full
                    ? styles.rsvpFull
                    : { backgroundColor: accent },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: rsvped, disabled: full }}
              accessibilityLabel={
                rsvped ? 'Going — tap to withdraw' : full ? 'Event full' : "I'm going"
              }
            >
              <Text
                style={[
                  styles.rsvpText,
                  { color: rsvped ? accent : full ? STONE_500 : onAccentInk },
                ]}
              >
                {rsvped ? 'Going' : full ? 'Event Full' : "I'm Going"}
              </Text>
              {rsvped ? (
                <Feather name="check" size={16} color={accent} />
              ) : full ? null : (
                <Feather name="arrow-right" size={16} color={onAccentInk} />
              )}
            </Pressable>
          ) : (
            <Text style={styles.ended}>This event has ended</Text>
          )}
        </LinearGradient>

        {seam && seam.width > 0 ? (
          // The shine: a narrow glint crossing the paper, then parked off the
          // ticket's left edge for the rest of the cycle.
          <Animated.View
            pointerEvents="none"
            style={[
              styles.shine,
              {
                width: SHINE_BAND,
                transform: [
                  {
                    translateX: shine.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-SHINE_BAND, seam.width],
                    }),
                  },
                ],
              },
            ]}
          >
            <LinearGradient
              colors={[
                'rgba(255,255,255,0)',
                'rgba(255,255,255,0.05)',
                'rgba(255,255,255,0.16)',
                'rgba(255,255,255,0.05)',
                'rgba(255,255,255,0)',
              ]}
              locations={[0, 0.3, 0.5, 0.7, 1]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
          </Animated.View>
        ) : null}
      </View>

      {seam && seam.width > 0 && seam.y > 0 ? (
        <Svg
          style={[styles.seam, { top: seam.y - NOTCH_R, width: seam.width + NOTCH_R * 2 }]}
          pointerEvents="none"
        >
          {/* Punch the cut-outs first: the disc erases the straight border that
              would otherwise run across the notch. */}
          <Circle cx={NOTCH_R} cy={NOTCH_R} r={NOTCH_R} fill={notchColor} />
          <Circle cx={seam.width + NOTCH_R} cy={NOTCH_R} r={NOTCH_R} fill={notchColor} />
          {/* The web draws the dash between the notch tangent points. */}
          <Line
            x1={NOTCH_R * 2}
            y1={NOTCH_R}
            x2={seam.width}
            y2={NOTCH_R}
            stroke={SEAM_STROKE}
            strokeWidth={TICKET_BORDER}
            strokeDasharray="5 6"
          />
          {/* Then the border continues around the half of each notch that bites
              into the paper, exactly like the web's outline path. */}
          <Path
            d={`M ${NOTCH_R} 0 A ${NOTCH_R} ${NOTCH_R} 0 0 1 ${NOTCH_R} ${NOTCH_R * 2}`}
            stroke={TICKET_BORDER_COLOR}
            strokeWidth={TICKET_BORDER}
            fill="none"
          />
          <Path
            d={`M ${seam.width + NOTCH_R} 0 A ${NOTCH_R} ${NOTCH_R} 0 0 0 ${seam.width + NOTCH_R} ${NOTCH_R * 2}`}
            stroke={TICKET_BORDER_COLOR}
            strokeWidth={TICKET_BORDER}
            fill="none"
          />
        </Svg>
      ) : null}
    </Animated.View>

    {confirm ? (
      <RsvpConfirmDialog
        mode={confirm}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          // Joining asks the host's compulsory questions before anything is
          // sent; withdrawing needs nothing and goes straight out.
          if (confirm === 'join') {
            setConfirm(null);
            setQuestionsOpen(true);
          } else {
            void commit();
          }
        }}
        eventTitle={event.title}
        eventDate={event.event_date}
        eventEnd={event.end_date ?? event.event_date}
        coverImageUrl={event.cover_image_url}
        chatMemberCount={event.chat_member_count ?? null}
        isOwner={isOwner}
        pending={pending}
        error={error}
      />
    ) : null}

    {questionsOpen ? (
      <EventJoinQuestionsModal
        onClose={() => setQuestionsOpen(false)}
        onSubmit={(answers) => void commit(answers)}
        eventTitle={event.title}
        communityName={communityName}
        pending={pending}
        error={error}
        confirmLabel="Confirm RSVP"
      />
    ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  // Unclipped parent so the notch cut-outs can cover the ticket's own border.
  // It is also the hanger: the whole card turns about this pivot.
  frame: { position: 'relative', transformOrigin: '50% 8px' },
  shine: {
    position: 'absolute',
    top: '-20%',
    bottom: '-20%',
    left: 0,
    zIndex: 5,
  },
  seam: {
    position: 'absolute',
    // The SVG clips at its own bounds, so the viewport overhangs the ticket by
    // a notch radius — otherwise the edge pixel of the right cut-out is dropped
    // and the paper border shows through the notch.
    left: -NOTCH_R,
    height: NOTCH_R * 2,
    // The ticket raises itself on Android; without a higher elevation the
    // paper would redraw over the cut-outs.
    zIndex: 10,
    elevation: 6,
  },
  ticket: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: TICKET_BORDER_COLOR,
    backgroundColor: TICKET_BG,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  posterPanel: { padding: 12 },
  posterWrap: { borderRadius: 8, overflow: 'hidden' },
  poster: { width: '100%' },
  posterFallback: { width: '100%', height: 176 },
  locationCaption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 12,
    paddingTop: 24,
  },
  locationText: {
    flex: 1,
    fontFamily: 'Geist_600SemiBold',
    fontSize: 14,
    color: '#ffffff',
  },

  body: { paddingHorizontal: 16, paddingVertical: 16 },
  title: {
    fontFamily: 'Geist_700Bold',
    fontSize: 16,
    lineHeight: 22,
    color: STONE_50,
  },

  meta: { marginTop: 12, gap: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { flexShrink: 1, fontFamily: 'Geist_500Medium', fontSize: 12, color: STONE_200 },
  metaLink: {
    color: STONE_200,
    textDecorationLine: 'underline',
    textDecorationColor: 'rgba(231,229,228,0.4)',
  },
  metaSpent: { color: STONE_500 },
  hostTime: {
    paddingLeft: 19,
    fontFamily: 'Geist_400Regular',
    fontSize: 11,
    color: STONE_400,
  },

  goingRow: { marginTop: 16, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  avatarStrip: { flexDirection: 'row', alignItems: 'center' },
  // The count rolls on its own, so the number keeps its own travelling box.
  goingLabel: { flexDirection: 'row', alignItems: 'flex-end' },
  goingWords: { marginLeft: 4 },
  goingText: { fontFamily: 'Geist_400Regular', fontSize: 12, color: STONE_400 },

  stub: {
    paddingHorizontal: 12,
    paddingVertical: 20,
    alignItems: 'center',
    gap: 14,
  },
  dateBlock: { alignItems: 'center' },
  stubWeekday: {
    fontFamily: 'Geist_700Bold',
    fontSize: 12,
    letterSpacing: 2.4,
    color: STONE_300,
  },
  stubDay: {
    fontFamily: 'Geist_700Bold',
    fontSize: 48,
    lineHeight: 50,
  },
  stubMonth: {
    fontFamily: 'Geist_700Bold',
    fontSize: 10,
    letterSpacing: 2.2,
    color: STONE_300,
    marginTop: 4,
  },
  rsvpButton: {
    width: '100%',
    minHeight: 44,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  rsvpFull: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  rsvpText: {
    fontFamily: 'Geist_700Bold',
    fontSize: 13,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  ended: { fontFamily: 'Geist_500Medium', fontSize: 12, color: STONE_500 },
});
