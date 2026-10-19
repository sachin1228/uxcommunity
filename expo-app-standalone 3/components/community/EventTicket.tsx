import React, { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { PersonAvatar } from '@/components/PersonAvatar';
import { formatEventDate } from '@/lib/eventDate';
import { formatEventTimeRange, hostScheduleForViewer } from '@/lib/eventDisplay';
import type { CommunityEvent } from '@/lib/communityContent';
import { hapticToggle } from '@/lib/haptics';

/**
 * The event ticket — a port of the web `EventCard`'s ticket body: poster,
 * title and schedule rows, the going strip, then the accent-tinted stub with
 * the big date and the RSVP call to action. On a phone the web card stacks
 * these three panels vertically (its sub-`lg` layout), so this one does too.
 *
 * The card keeps the web's fixed dark paper and prints its own colors: the
 * ticket is deliberately the same black in both themes, and the accent color
 * the host picked is the only hue on it.
 */

const ACCENT_FALLBACK = '#e8e14a';
const TICKET_BG = '#111111';
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

interface EventTicketProps {
  event: CommunityEvent;
  goingCount: number;
  rsvped: boolean;
  onToggleRsvp: () => void;
  /** Feed cards clamp the title; the event page lets it wrap in full. */
  variant?: 'card' | 'detail';
}

export function EventTicket({
  event,
  goingCount,
  rsvped,
  onToggleRsvp,
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

  const gradient =
    POSTER_GRADIENTS[(event.id.charCodeAt(0) || 0) % POSTER_GRADIENTS.length];

  return (
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
      <View style={styles.body}>
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
            {event.rsvps?.length ? (
              <View style={styles.avatarStrip}>
                {event.rsvps.slice(0, 5).map((rsvp, index) => (
                  <PersonAvatar
                    key={rsvp.user_id || `attendee-${index}`}
                    name={rsvp.users?.name}
                    url={rsvp.users?.avatar_url}
                    size={28}
                    style={{
                      marginLeft: index === 0 ? 0 : -8,
                      zIndex: 10 - index,
                      borderWidth: 2,
                      borderColor: TICKET_BG,
                    }}
                  />
                ))}
              </View>
            ) : null}
            <Text style={styles.goingText}>
              {count} {count === 1 ? 'person' : 'people'} going
            </Text>
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

        <View style={styles.stubDivider} />

        {!past ? (
          <Pressable
            onPress={() => {
              hapticToggle(!rsvped);
              onToggleRsvp();
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
              <Feather name="check" size={14} color={accent} />
            ) : full ? null : (
              <Feather name="arrow-right" size={14} color={onAccentInk} />
            )}
          </Pressable>
        ) : (
          <Text style={styles.ended}>This event has ended</Text>
        )}
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  ticket: {
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.16)',
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
  stubDivider: { width: '80%', height: 1, backgroundColor: 'rgba(255,255,255,0.1)' },
  rsvpButton: {
    width: '100%',
    minHeight: 36,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
  },
  rsvpFull: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  rsvpText: {
    fontFamily: 'Geist_700Bold',
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  ended: { fontFamily: 'Geist_500Medium', fontSize: 12, color: STONE_500 },
});
