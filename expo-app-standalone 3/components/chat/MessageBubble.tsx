import React, { Fragment, useState } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { Message, Reaction } from '@/lib/communities';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  message: Message;
  isOwn: boolean;
  isSameAuthor: boolean;
  onLongPress: (message: Message) => void;
  onReactionPress: (messageId: string, emoji: string) => void;
  currentUserId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Returns true when the entire string is 1–3 emoji with no other content.
 */
function isEmojiOnly(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const emojiRegex = /\p{Emoji_Presentation}/gu;
  const matches = trimmed.match(emojiRegex);
  if (!matches || matches.length > 3) return false;
  const remainder = trimmed.replace(emojiRegex, '').replace(/\s/g, '');
  return remainder.length === 0;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/**
 * Avatar with URL support and automatic initials fallback.
 * Fix #5: uses onError to fall back to initials when the URL fails to load.
 */
function Avatar({
  name,
  avatarUrl,
  colors,
}: {
  name: string;
  avatarUrl: string | null;
  colors: ReturnType<typeof useColors>;
}) {
  const [imageError, setImageError] = useState(false);
  const letters = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  const showImage = !!avatarUrl && !imageError;

  return (
    <View
      style={[
        styles.avatar,
        { backgroundColor: colors.primarySoft, overflow: 'hidden' },
      ]}
    >
      {showImage ? (
        <Image
          source={{ uri: avatarUrl! }}
          style={styles.avatarImage}
          onError={() => setImageError(true)}
        />
      ) : (
        <Text style={[styles.avatarText, { color: colors.primary }]}>{letters}</Text>
      )}
    </View>
  );
}

function ReactionChips({
  reactions,
  currentUserId,
  messageId,
  onReactionPress,
  colors,
}: {
  reactions: Reaction[];
  currentUserId: string;
  messageId: string;
  onReactionPress: (messageId: string, emoji: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  if (!reactions || reactions.length === 0) return null;
  return (
    <View style={styles.reactions}>
      {reactions.map((r) => {
        const isActive = r.user_ids.includes(currentUserId);
        return (
          <Pressable
            key={r.emoji}
            onPress={() => onReactionPress(messageId, r.emoji)}
            style={[
              styles.reactionChip,
              {
                backgroundColor: isActive ? colors.primarySoft : '#2a2a2a',
                borderColor: isActive ? colors.primary : '#000',
              },
            ]}
          >
            <Text style={styles.reactionEmoji}>{r.emoji}</Text>
            {r.user_ids.length > 1 && (
              <Text
                style={[
                  styles.reactionCount,
                  { color: isActive ? colors.primary : colors.mutedForeground },
                ]}
              >
                {r.user_ids.length}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function ReplyPreview({
  replyTo,
  colors,
}: {
  replyTo: NonNullable<Message['reply_to']>;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={[
        styles.replyPreview,
        { borderLeftColor: colors.primary, backgroundColor: 'rgba(0,0,0,0.15)' },
      ]}
    >
      <Text style={[styles.replyName, { color: 'rgba(255,255,255,0.8)' }]}>
        {replyTo.user_name}
      </Text>
      <Text style={[styles.replyContent, { color: 'rgba(255,255,255,0.6)' }]} numberOfLines={1}>
        {replyTo.content ?? '📷 Image'}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function MessageBubble({
  message,
  isOwn,
  isSameAuthor,
  onLongPress,
  onReactionPress,
  currentUserId,
}: Props) {
  const colors = useColors();

  const sender = message.users;
  const senderName = sender?.name ?? (isOwn ? 'You' : 'Unknown');
  const showHeader = !isSameAuthor;
  const isDeleted = !!message.deleted_at;
  const isEmojiMsg =
    !isDeleted &&
    !message.image_url &&
    !message.reply_to &&
    !!message.content &&
    isEmojiOnly(message.content);

  // Fix #1/#2: time color
  const timeColor = isOwn ? 'rgba(255,255,255,0.6)' : colors.mutedForeground;

  return (
    <View
      style={[
        styles.row,
        isSameAuthor ? styles.rowCompact : styles.rowFirst,
      ]}
    >
      {/* ── Left avatar column (always present, Slack-style) ── */}
      <View style={styles.avatarCol}>
        {showHeader && (
          <Avatar
            name={senderName}
            avatarUrl={sender?.avatar_url ?? null}
            colors={colors}
          />
        )}
      </View>

      {/* ── Content column ── */}
      <View style={styles.contentCol}>
        {/* Fix #3: sender name only — no designation/company badge */}
        {showHeader && !isDeleted && (
          <Text style={[styles.senderName, { color: colors.mutedForeground }]}>
            {senderName}
          </Text>
        )}

        {/* ── Deleted message ── */}
        {isDeleted ? (
          <View
            style={[
              styles.deletedBubble,
              {
                backgroundColor: isOwn ? 'rgba(0,112,243,0.3)' : colors.card,
                borderColor: isOwn ? 'rgba(255,255,255,0.1)' : colors.border,
              },
            ]}
          >
            <Text style={[styles.deletedIcon, { color: isOwn ? 'rgba(255,255,255,0.4)' : colors.mutedForeground }]}>
              ⊘
            </Text>
            <Text style={[styles.deletedText, { color: isOwn ? 'rgba(255,255,255,0.5)' : colors.mutedForeground }]}>
              {isOwn ? 'You deleted this message' : 'This message was deleted'}
            </Text>
            <Text style={[styles.deletedTime, { color: timeColor }]}>
              {formatTime(message.created_at)}
            </Text>
          </View>
        ) : isEmojiMsg ? (
          /* ── Big emoji — no bubble ── */
          <View style={styles.emojiContainer}>
            <Text style={styles.bigEmoji}>{message.content}</Text>
            {/* Fix #1: time on its own line, right-aligned */}
            <View style={styles.timeRow}>
              <Text style={[styles.timeText, { color: colors.mutedForeground }]}>
                {formatTime(message.created_at)}
              </Text>
              {isOwn && (
                <Ionicons name="checkmark-done" size={13} color={colors.mutedForeground} />
              )}
            </View>
            <ReactionChips
              reactions={message.reactions}
              currentUserId={currentUserId}
              messageId={message.id}
              onReactionPress={onReactionPress}
              colors={colors}
            />
          </View>
        ) : (
          /* ── Normal bubble ── */
          <Fragment>
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
              {/* Reply preview inside bubble */}
              {message.reply_to && !message.reply_to.id.startsWith('deleted') && (
                <ReplyPreview replyTo={message.reply_to} colors={colors} />
              )}

              {/* Image */}
              {message.image_url && (
                <Image
                  source={{ uri: message.image_url }}
                  style={styles.messageImage}
                  resizeMode="cover"
                />
              )}

              {/* Fix #1/#2: text content without inline time (no flex-wrap hack) */}
              {message.content && (
                <Text
                  style={[
                    styles.content,
                    { color: isOwn ? colors.primaryForeground : colors.foreground },
                  ]}
                >
                  {message.content}
                </Text>
              )}

              {/* Fix #1: time always on its own line, right-aligned — mirrors web */}
              <View style={styles.timeRow}>
                <Text style={[styles.timeText, { color: timeColor }]}>
                  {formatTime(message.created_at)}
                </Text>
                {isOwn && (
                  <Ionicons name="checkmark-done" size={13} color={timeColor} />
                )}
              </View>
            </Pressable>

            {/* Reactions below bubble */}
            <ReactionChips
              reactions={message.reactions}
              currentUserId={currentUserId}
              messageId={message.id}
              onReactionPress={onReactionPress}
              colors={colors}
            />
          </Fragment>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 12,
    gap: 8,
  },
  rowFirst: {
    marginTop: 12,
  },
  rowCompact: {
    marginTop: 2,
  },

  avatarCol: {
    width: 28,
    flexShrink: 0,
    alignItems: 'center',
    marginTop: 2,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 28,
    height: 28,
  },
  avatarText: {
    fontSize: 11,
    fontFamily: 'Geist_600SemiBold',
  },

  contentCol: {
    flex: 1,
    minWidth: 0,
    maxWidth: '85%',
    gap: 2,
  },

  // Fix #3: sender name only, no badge
  senderName: {
    fontSize: 12,
    fontFamily: 'Geist_600SemiBold',
    marginBottom: 2,
    marginLeft: 2,
  },

  deletedBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  deletedIcon: {
    fontSize: 13,
  },
  deletedText: {
    fontSize: 12,
    fontFamily: 'Geist_400Regular',
    fontStyle: 'italic',
  },
  deletedTime: {
    fontSize: 10,
    fontFamily: 'Geist_400Regular',
    marginLeft: 4,
  },

  emojiContainer: {
    alignSelf: 'flex-start',
    gap: 4,
  },
  bigEmoji: {
    fontSize: 40,
    lineHeight: 48,
  },

  bubble: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },

  replyPreview: {
    borderLeftWidth: 2,
    paddingLeft: 8,
    paddingVertical: 4,
    borderRadius: 4,
    marginBottom: 6,
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

  messageImage: {
    width: 220,
    height: 160,
    borderRadius: 10,
    marginBottom: 4,
  },

  content: {
    fontSize: 15,
    fontFamily: 'Geist_400Regular',
    lineHeight: 21,
  },

  // Fix #1/#2: time always on its own line, right-aligned — matches web layout
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 3,
    marginTop: 3,
    marginLeft: 8, // small left offset to match web spacing
  },
  timeText: {
    fontSize: 10,
    fontFamily: 'Geist_400Regular',
  },

  reactions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
    marginLeft: 2,
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
});
