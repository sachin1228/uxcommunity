import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Message, Reaction } from '@/lib/communities';

interface Props {
  message: Message;
  isOwn: boolean;
  onLongPress: (message: Message) => void;
  onReactionPress: (messageId: string, emoji: string) => void;
  currentUserId: string;
}

function Avatar({ name, colors }: { name: string; colors: ReturnType<typeof useColors> }) {
  const letters = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  return (
    <View style={[styles.avatar, { backgroundColor: colors.primarySoft }]}>
      <Text style={[styles.avatarText, { color: colors.primary }]}>{letters}</Text>
    </View>
  );
}

function ReactionChip({
  reaction,
  isActive,
  onPress,
  colors,
}: {
  reaction: Reaction;
  isActive: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.reactionChip,
        {
          backgroundColor: isActive ? colors.primarySoft : colors.subtle,
          borderColor: isActive ? colors.primary : colors.border,
        },
      ]}
    >
      <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
      {reaction.user_ids.length > 1 && (
        <Text style={[styles.reactionCount, { color: isActive ? colors.primary : colors.mutedForeground }]}>
          {reaction.user_ids.length}
        </Text>
      )}
    </Pressable>
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function MessageBubble({ message, isOwn, onLongPress, onReactionPress, currentUserId }: Props) {
  const colors = useColors();

  if (message.deleted_at) {
    return (
      <View style={[styles.row, isOwn && styles.rowOwn]}>
        <Text style={[styles.deletedText, { color: colors.mutedForeground, borderColor: colors.border }]}>
          🗑 Message deleted
        </Text>
      </View>
    );
  }

  const senderName = message.users?.name ?? (isOwn ? 'You' : 'Unknown');

  // Time color: slightly transparent white for own, muted for others
  const timeColor = isOwn ? 'rgba(255,255,255,0.65)' : colors.mutedForeground;

  return (
    <View style={[styles.row, isOwn && styles.rowOwn]}>
      {/* Avatar — only for others, aligned to bottom of bubble */}
      {!isOwn && (
        <Avatar name={senderName} colors={colors} />
      )}

      <View style={[styles.bubbleWrapper, isOwn && styles.bubbleWrapperOwn]}>
        {/* Sender name — above the bubble, others only */}
        {!isOwn && (
          <Text style={[styles.senderName, { color: colors.mutedForeground }]}>{senderName}</Text>
        )}

        {/* Reply preview */}
        {message.reply_to && !message.reply_to.id.startsWith('deleted') && (
          <View
            style={[
              styles.replyPreview,
              { borderLeftColor: colors.primary, backgroundColor: colors.subtle },
            ]}
          >
            <Text style={[styles.replyName, { color: colors.primary }]}>
              {message.reply_to.user_name}
            </Text>
            <Text style={[styles.replyContent, { color: colors.mutedForeground }]} numberOfLines={1}>
              {message.reply_to.content ?? '📷 Image'}
            </Text>
          </View>
        )}

        {/* Bubble — message + time inside */}
        <Pressable
          onLongPress={() => onLongPress(message)}
          delayLongPress={350}
          style={[
            styles.bubble,
            {
              backgroundColor: isOwn ? colors.primary : colors.card,
              borderColor: isOwn ? 'transparent' : colors.border,
            },
          ]}
        >
          {/* Image */}
          {message.image_url && (
            <Image
              source={{ uri: message.image_url }}
              style={styles.messageImage}
              resizeMode="cover"
            />
          )}

          {/* Text + time row */}
          {message.content && (
            <View style={styles.contentRow}>
              <Text
                style={[
                  styles.content,
                  { color: isOwn ? colors.primaryForeground : colors.foreground },
                ]}
              >
                {message.content}
                {/* invisible spacer so time never overlaps text */}
                {'  '}
              </Text>
              <Text style={[styles.timeInline, { color: timeColor }]}>
                {formatTime(message.created_at)}
              </Text>
            </View>
          )}

          {/* Time below image (when image-only message) */}
          {message.image_url && !message.content && (
            <Text style={[styles.timeImage, { color: timeColor }]}>
              {formatTime(message.created_at)}
            </Text>
          )}
        </Pressable>

        {/* Reactions */}
        {message.reactions.length > 0 && (
          <View style={[styles.reactions, isOwn && styles.reactionsOwn]}>
            {message.reactions.map((r) => (
              <ReactionChip
                key={r.emoji}
                reaction={r}
                isActive={r.user_ids.includes(currentUserId)}
                onPress={() => onReactionPress(message.id, r.emoji)}
                colors={colors}
              />
            ))}
          </View>
        )}
      </View>

      {/* Spacer for own messages (no avatar) */}
      {isOwn && <View style={styles.avatarSpacer} />}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 12,
    paddingVertical: 3,
    gap: 8,
  },
  rowOwn: {
    flexDirection: 'row-reverse',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    alignSelf: 'flex-end',
  },
  avatarText: {
    fontSize: 12,
    fontFamily: 'Geist_600SemiBold',
  },
  avatarSpacer: {
    width: 32,
    flexShrink: 0,
  },
  bubbleWrapper: {
    maxWidth: '75%',
    gap: 2,
  },
  bubbleWrapperOwn: {
    alignItems: 'flex-end',
  },
  senderName: {
    fontSize: 12,
    fontFamily: 'Geist_500Medium',
    marginLeft: 4,
    marginBottom: 2,
  },
  replyPreview: {
    borderLeftWidth: 3,
    paddingLeft: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginBottom: 4,
    gap: 2,
  },
  replyName: {
    fontSize: 11,
    fontFamily: 'Geist_600SemiBold',
  },
  replyContent: {
    fontSize: 12,
    fontFamily: 'Geist_400Regular',
  },
  bubble: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  messageImage: {
    width: 220,
    height: 160,
    borderRadius: 10,
    marginBottom: 4,
  },
  // Text and time sit in a flex-wrap row so time tucks to the bottom-right
  contentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
  },
  content: {
    fontSize: 15,
    fontFamily: 'Geist_400Regular',
    lineHeight: 21,
    flexShrink: 1,
  },
  timeInline: {
    fontSize: 11,
    fontFamily: 'Geist_400Regular',
    alignSelf: 'flex-end',
    marginLeft: 4,
    marginBottom: 1,
  },
  // Time shown below an image-only bubble
  timeImage: {
    fontSize: 11,
    fontFamily: 'Geist_400Regular',
    alignSelf: 'flex-end',
    marginTop: 4,
  },
  reactions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
    marginLeft: 4,
  },
  reactionsOwn: {
    marginLeft: 0,
    marginRight: 4,
    justifyContent: 'flex-end',
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    gap: 3,
  },
  reactionEmoji: {
    fontSize: 14,
  },
  reactionCount: {
    fontSize: 12,
    fontFamily: 'Geist_500Medium',
  },
  deletedText: {
    fontSize: 13,
    fontFamily: 'Geist_400Regular',
    fontStyle: 'italic',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginHorizontal: 12,
  },
});
