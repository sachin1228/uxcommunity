import React, { useEffect, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { Community } from '@/lib/communities';

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

  // Reaction:
  //  - own message reacted to → "John reacted 👍 to your message"
  //  - other message with text → "John reacted 👍 to: <preview>"
  //  - pending (text not resolved yet) → "John reacted 👍"
  if (community.lastReaction) {
    const { emoji, firstName, isOwn, targetIsOwn, messagePreview } = community.lastReaction;
    const who = isOwn ? 'You' : firstName;
    const to = targetIsOwn
      ? ' to your message'
      : messagePreview
        ? ` to: ${messagePreview}`
        : '';
    return { text: `${who} reacted ${emoji}${to}` };
  }

  // Last message — mirrors web formatPreview() priority exactly:
  // deleted → image-only → reply → plain content
  if (community.last_message) {
    const { content, user, is_own, is_reply, reply_to_user, reply_to_is_own, is_deleted, has_image } =
      community.last_message;
    const sender = is_own ? 'You' : user.name ? user.name.split(' ')[0] : '';

    if (is_deleted) {
      return { prefix: sender, text: 'Message deleted' };
    }

    if (has_image && !content) {
      return { prefix: sender, text: '📷 Photo' };
    }

    if (is_reply) {
      // A reply to the current user's own message reads as a clean sentence:
      // "John replied to your message" (no colon prefix, no snippet).
      if (reply_to_is_own) {
        return { text: `${sender} replied to your message` };
      }
      return {
        prefix: sender,
        text: reply_to_user
          ? `replied to ${reply_to_user}: ${content ?? ''}`
          : `replied: ${content ?? ''}`,
      };
    }

    return { prefix: sender, text: content ?? '' };
  }

  return { text: 'No messages yet' };
}

// ---------------------------------------------------------------------------
// CommunityRow
// ---------------------------------------------------------------------------

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
        { backgroundColor: pressed ? colors.surface : colors.subtle },
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
            {community.is_private && (
              <Feather
                name="lock"
                size={11}
                color={colors.mutedForeground}
                style={styles.lockIcon}
                accessibilityLabel="Private community"
              />
            )}
          </View>
          <Text style={[styles.time, { color: colors.foregroundSoft }]}>
            {formatTime(lastTime)}
          </Text>
        </View>

        {/* Member count + city reference name */}
        <Text style={[styles.memberCount, { color: colors.foregroundSoft }]} numberOfLines={1}>
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
  lockIcon: {
    marginTop: 1,
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
