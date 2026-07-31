import React, { useEffect, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Community } from '@/lib/communities';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  community: Community;
  typingLabel: string | null;
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

  // Last message
  if (community.last_message) {
    const { content, user, is_reply, reply_to_user } = community.last_message;
    const sender = user.name ? user.name.split(' ')[0] : '';

    if (!content && community.last_message.hasOwnProperty('image_url')) {
      return { prefix: sender, text: '📷 Photo' };
    }

    if (is_reply) {
      const replyTo = reply_to_user;
      return {
        prefix: sender,
        text: replyTo
          ? `replied to ${replyTo}: ${content ?? ''}`
          : `replied: ${content ?? ''}`,
      };
    }

    return { prefix: sender, text: content ?? '📷 Photo' };
  }

  return { text: 'No messages yet' };
}

// ---------------------------------------------------------------------------
// CommunityRow
// ---------------------------------------------------------------------------

const GREEN = '#22c55e'; // matches web bg-green-500

export function CommunityRow({ community, typingLabel, onPress }: Props) {
  const colors = useColors();

  const lastTime =
    community.lastReaction?.createdAt ??
    community.last_message?.created_at ??
    community.joined_at;

  const isTyping = !!typingLabel;
  const { text, prefix } = previewText(community, typingLabel);

  const hasUnread = community.unread_count > 0;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.subtle : colors.background },
      ]}
      onPress={onPress}
    >
      {/* Avatar — start aligned */}
      <View style={styles.avatarWrap}>
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
      </View>

      {/* Body */}
      <View style={styles.body}>
        {/* Name + time */}
        <View style={styles.topRow}>
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
          <Text style={[styles.time, { color: colors.foregroundSoft }]}>
            {formatTime(lastTime)}
          </Text>
        </View>

        {/* Member count */}
        <Text style={[styles.memberCount, { color: colors.foregroundSoft }]}>
          {community.member_count === 1
            ? '1 member'
            : `${community.member_count} members`}
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
              style={[
                styles.preview,
                {
                  color: hasUnread ? colors.foreground : colors.foregroundSoft,
                  fontFamily: hasUnread ? 'Geist_500Medium' : 'Geist_400Regular',
                },
              ]}
              numberOfLines={1}
            >
              {prefix ? (
                // Can't use JSX inside a Text string template, so compose manually
                `${prefix}: ${text}`
              ) : text}
            </Text>
          )}

          {/* Unread badge — green, matches web */}
          {hasUnread && (
            <View style={[styles.badge, { backgroundColor: GREEN }]}>
              <Text style={styles.badgeText}>
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
  name: {
    fontSize: 16,
    fontFamily: 'Geist_500Medium',
    flex: 1,
  },
  nameBold: {
    fontFamily: 'Geist_600SemiBold',
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
    flex: 1,
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
    color: '#FFFFFF',
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
