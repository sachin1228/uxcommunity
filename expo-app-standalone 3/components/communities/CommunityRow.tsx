import React, { useEffect, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { useColors } from '@/hooks/useColors';
import { Community } from '@/lib/communities';
import { formatLastMessagePreview } from '@/lib/communityPreview';
import { isCommunityMuted } from '@/lib/communityMute';
import { CommunityNameBadges } from '@/components/communities/CommunityBadges';
import { DpWithEventDate } from '@/components/communities/DpWithEventDate';

// ---------------------------------------------------------------------------
// Member count formatting — mirrors web's fmtCount (1.2k / 3M)
// ---------------------------------------------------------------------------

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  community: Community;
  typingLabel: string | null;
  /** The list's slow clock — pin and mute marks lapse against it (see useCommunities). */
  nowMs: number;
  onPress: () => void;
}

// ---------------------------------------------------------------------------
// Animated typing dots
// ---------------------------------------------------------------------------

function TypingDots({ color }: { color: string }) {
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0.3, duration: 300, useNativeDriver: true }),
          Animated.delay(600 - delay),
        ])
      );
    const a1 = pulse(dot1, 0);
    const a2 = pulse(dot2, 150);
    const a3 = pulse(dot3, 300);
    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, [dot1, dot2, dot3]);

  return (
    <View style={styles.dotsRow}>
      {[dot1, dot2, dot3].map((dot, i) => (
        <Animated.View
          key={i}
          style={[styles.dot, { backgroundColor: color, opacity: dot }]}
        />
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Pin mark — the web row's Pin glyph (lucide), drawn with Svg (Feather has no pin)
// ---------------------------------------------------------------------------

function PinIcon({ size, color }: { size: number; color: string }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M12 17v5" />
      <Path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Avatar / Initials
// ---------------------------------------------------------------------------

function Initials({
  name,
  size = 48,
  colors,
}: {
  name: string;
  size?: number;
  colors: ReturnType<typeof useColors>;
}) {
  const letters = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <View
      style={[
        styles.avatarBase,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primarySoft },
      ]}
    >
      <Text style={[styles.avatarText, { color: colors.primary, fontSize: size * 0.38 }]}>
        {letters}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Time helper
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// ---------------------------------------------------------------------------
// Preview text — mirrors web wording exactly
// ---------------------------------------------------------------------------

function previewText(
  community: Community,
  typingLabel: string | null
): { text: string; prefix?: string } {
  // Typing takes priority — handled separately via TypingDots
  if (typingLabel) return { text: typingLabel };

  // Reaction: "<Name> reacted 👍 to: <preview>"
  if (community.lastReaction) {
    const { emoji, firstName, isOwn, messagePreview } = community.lastReaction;
    const who = isOwn ? 'You' : firstName;
    const to = messagePreview ? ` to: ${messagePreview}` : '';
    return { text: `${who} reacted ${emoji}${to}` };
  }

  // Last message — mirrors web formatPreview() priority exactly:
  // deleted → image-only → reply → plain content
  if (community.last_message) {
    return formatLastMessagePreview(community.last_message);
  }

  return { text: 'No messages yet' };
}

// ---------------------------------------------------------------------------
// CommunityRow
// ---------------------------------------------------------------------------

export function CommunityRow({ community, typingLabel, nowMs, onPress }: Props) {
  const colors = useColors();

  const lastTime =
    community.lastReaction?.createdAt ??
    community.last_message?.created_at ??
    community.joined_at;

  const isTyping = !!typingLabel;
  const { text, prefix } = previewText(community, typingLabel);

  const hasUnread = community.unread_count > 0;
  // Timed mutes lapse on their own without the row being rewritten, so the
  // mark is computed from the deadline against the list's clock.
  const isMuted = isCommunityMuted(community, nowMs);

  return (
    <Pressable
      // Transparent by default so the page background shows through the list,
      // exactly like the web sidebar rows; pressing lifts the row onto the
      // raised surface (the web's hover/active treatment).
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
      ]}
      onPress={onPress}
    >
      {/* Avatar — start aligned. An event's group chat wears its event date
          as a calendar tile over the same face everywhere (web parity). */}
      <View style={styles.avatarWrap}>
        <DpWithEventDate
          date={community.event_date}
          endsAt={community.event_end ?? community.pinned_until}
          dpSize={48}
        >
          {community.image_url ? (
            <Image
              source={{ uri: community.image_url }}
              style={[
                styles.avatarBase,
                { width: 48, height: 48, borderRadius: 24, borderColor: colors.border },
              ]}
            />
          ) : (
            <Initials name={community.name} colors={colors} />
          )}
        </DpWithEventDate>
      </View>

      {/* Body */}
      <View style={styles.body}>
        {/* Name + badges + time — the name line carries the verified seal
            and the globe/lock ("Electro ✓ 🔒", "Electro 🌐"), exactly like
            the web sidebar. */}
        <View style={styles.topRow}>
          <View style={styles.nameGroup}>
            <Text
              style={[
                styles.name,
                { color: colors.foreground },
                hasUnread && styles.nameBold,
              ]}
              numberOfLines={1}
            >
              {community.name}
            </Text>
            <CommunityNameBadges
              type={community.type}
              isPrivate={community.is_private}
              size={12}
            />
          </View>
          <Text style={[styles.time, { color: colors.foregroundSoft }]}>
            {formatTime(lastTime)}
          </Text>
        </View>

        {/* Member count + city reference name */}
        <Text style={[styles.memberCount, { color: colors.foregroundMuted }]} numberOfLines={1}>
          {community.member_count === 1
            ? '1 member'
            : `${fmtCount(community.member_count)} members`}
          {community.type === 'city' && community.reference_name
            ? ` · ${community.reference_name}`
            : ''}
        </Text>

        {/* Preview / typing */}
        <View style={styles.bottomRow}>
          {isTyping ? (
            <View style={styles.typingRow}>
              <Text
                style={[styles.preview, { color: colors.primary, fontFamily: 'Geist_500Medium' }]}
                numberOfLines={1}
              >
                {text}
              </Text>
              <TypingDots color={colors.primary} />
            </View>
          ) : (
            <Text
              style={[styles.preview, { color: colors.foregroundMuted }]}
              numberOfLines={1}
            >
              {prefix ? (
                <>
                  <Text style={styles.previewPrefix}>{`${prefix}: `}</Text>
                  {text}
                </>
              ) : text}
            </Text>
          )}

          {/* Muted — the crossed bell rides the preview line ahead of the
              count. Notifications are off; unread messages still count. */}
          {isMuted && (
            <Feather
              name="bell-off"
              size={14}
              strokeWidth={2.5}
              color={colors.mutedForeground}
              style={styles.previewMark}
              accessibilityLabel="Notifications muted"
            />
          )}

          {/* An event's chat stays pinned to the top of the list until its
              event date; the mark says why it's up there. It follows the
              mute bell and hands the row to the count. */}
          {community.pinned_until && (
            <View
              accessible
              accessibilityLabel="Pinned until the event"
              style={styles.previewMark}
            >
              <PinIcon size={14} color={colors.mutedForeground} />
            </View>
          )}

          {/* Unread badge */}
          {hasUnread && (
            <View style={[styles.badge, { backgroundColor: colors.success }]}>
              <Text style={[styles.badgeText, { color: colors.successForeground }]}>
                {community.unread_count > 99 ? '99+' : community.unread_count}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 12,
  },
  avatarWrap: {
    marginTop: 2,
  },
  avatarBase: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatarText: {
    fontFamily: 'Geist_600SemiBold',
  },
  body: {
    flex: 1,
    gap: 3,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  nameGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minWidth: 0,
  },
  name: {
    fontSize: 16,
    fontFamily: 'Geist_500Medium',
    flexShrink: 1,
  },
  nameBold: {
    fontFamily: 'Geist_600SemiBold',
  },
  previewMark: {
    // The preview line is an items-center row, so the marks center against it
    // (web parity: the bell and pin ride the text's top edge there because its
    // line is items-start; here they self-center, like the app's other rows).
    alignSelf: 'center',
    flexShrink: 0,
  },
  time: {
    fontSize: 13,
    fontFamily: 'Geist_400Regular',
  },
  memberCount: {
    fontSize: 12,
    fontFamily: 'Geist_400Regular',
    marginTop: -1,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  typingRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  preview: {
    fontSize: 14,
    fontFamily: 'Geist_400Regular',
    flex: 1,
  },
  previewPrefix: {
    fontFamily: 'Geist_500Medium',
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontFamily: 'Geist_600SemiBold',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
});
