import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Community } from '@/lib/communities';

interface Props {
  community: Community;
  typingLabel: string | null;
  onPress: () => void;
}

function Initials({ name, size = 44, colors }: { name: string; size?: number; colors: ReturnType<typeof useColors> }) {
  const letters = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primarySoft },
      ]}
    >
      <Text style={[styles.avatarText, { color: colors.primary, fontSize: size * 0.38 }]}>
        {letters}
      </Text>
    </View>
  );
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function previewText(community: Community, typingLabel: string | null): string {
  if (typingLabel) return typingLabel;
  if (community.lastReaction) {
    const { emoji, firstName, isOwn, messagePreview } = community.lastReaction;
    const who = isOwn ? 'You' : firstName;
    const preview = messagePreview ? ` "${messagePreview}"` : '';
    return `${who} reacted ${emoji}${preview}`;
  }
  if (community.last_message) {
    const { content, user, is_reply } = community.last_message;
    const prefix = is_reply ? '↩ ' : '';
    const text = content ?? '📷 Image';
    return `${prefix}${user.name ? `${user.name}: ` : ''}${text}`;
  }
  return 'No messages yet';
}

export function CommunityRow({ community, typingLabel, onPress }: Props) {
  const colors = useColors();

  const lastTime =
    community.lastReaction?.createdAt ??
    community.last_message?.created_at ??
    community.joined_at;

  const isTyping = !!typingLabel;
  const preview = previewText(community, typingLabel);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.subtle : colors.background,
          borderBottomColor: colors.border,
        },
      ]}
      onPress={onPress}
    >
      {/* Avatar */}
      {community.image_url ? (
        <Image
          source={{ uri: community.image_url }}
          style={[styles.avatar, { borderRadius: 22, borderColor: colors.border }]}
        />
      ) : (
        <Initials name={community.name} colors={colors} />
      )}

      {/* Body */}
      <View style={styles.body}>
        <View style={styles.topRow}>
          <Text
            style={[
              styles.name,
              { color: colors.foreground },
              community.unread_count > 0 && styles.nameBold,
            ]}
            numberOfLines={1}
          >
            {community.name}
          </Text>
          <Text style={[styles.time, { color: colors.mutedForeground }]}>
            {formatTime(lastTime)}
          </Text>
        </View>

        <View style={styles.bottomRow}>
          <Text
            style={[
              styles.preview,
              {
                color: isTyping ? colors.primary : community.unread_count > 0 ? colors.foreground : colors.mutedForeground,
                fontFamily: isTyping || community.unread_count > 0 ? 'Inter_500Medium' : 'Inter_400Regular',
              },
            ]}
            numberOfLines={1}
          >
            {preview}
          </Text>

          {community.unread_count > 0 && (
            <View style={[styles.badge, { backgroundColor: colors.primary }]}>
              <Text style={[styles.badgeText, { color: colors.primaryForeground }]}>
                {community.unread_count > 99 ? '99+' : community.unread_count}
              </Text>
            </View>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  avatarText: {
    fontFamily: 'Inter_600SemiBold',
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
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    flex: 1,
  },
  nameBold: {
    fontFamily: 'Inter_600SemiBold',
  },
  time: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  preview: {
    fontSize: 13,
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
    fontFamily: 'Inter_600SemiBold',
  },
});
