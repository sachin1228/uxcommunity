import React, { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { Message, Reaction } from '@/lib/communities';
import { hapticImpact } from '@/lib/haptics';
import { resolveProfilePictureUri } from '@/lib/profilePicture';
import {
  COLLAPSED_LINES,
  fmtTime,
  isEmojiOnly,
  splitContentForRender,
  userNameColor,
} from '@/lib/chat';
import { MessageBubbleTail } from './MessageBubbleTail';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  message: Message;
  isOwn: boolean;
  isSameAuthor: boolean;
  currentUserId: string;
  onLongPress: (message: Message) => void;
  onReactionPress: (messageId: string, emoji: string) => void;
  onImagePress?: (uri: string) => void;
  onCancel?: (tempId: string) => void;
  onRetry?: (tempId: string) => void;
  /** Jumps the list to the message this one replies to. */
  onReplyPress?: (messageId: string) => void;
}

type Palette = ReturnType<typeof useColors>;

const EMOJI_MESSAGE_SIZE = 48;

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

function Avatar({
  name,
  avatarUrl,
  colors,
  size = 28,
}: {
  name: string;
  avatarUrl: string | null;
  colors: Palette;
  size?: number;
}) {
  const resolvedUri = resolveProfilePictureUri(avatarUrl);
  const [imageError, setImageError] = useState(false);

  const letters = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: colors.surfaceRaised },
      ]}
    >
      {resolvedUri && !imageError ? (
        <Image
          source={{ uri: resolvedUri }}
          style={{ width: size, height: size }}
          onError={() => setImageError(true)}
        />
      ) : (
        <Text style={[styles.avatarText, { color: colors.mutedForeground }]}>{letters}</Text>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Reaction pills — sit half-outside the bubble, WhatsApp-style
// ---------------------------------------------------------------------------

function ReactionPills({
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
  colors: Palette;
}) {
  if (!reactions || reactions.length === 0) return null;

  return (
    <View style={styles.reactionPills}>
      {reactions.map(({ emoji, user_ids }) => {
        const iMine = user_ids.includes(currentUserId);
        return (
          <Pressable
            key={emoji}
            onPress={() => onReactionPress(messageId, emoji)}
            hitSlop={4}
            accessibilityLabel={iMine ? `Remove ${emoji} reaction` : `Add ${emoji} reaction`}
            style={({ pressed }) => [
              styles.reactionPill,
              {
                backgroundColor: colors.chatReactionPill,
                // Web hard-codes a black ring on both themes.
                borderColor: '#000',
                opacity: pressed ? 0.75 : 1,
              },
            ]}
          >
            <Text style={styles.reactionPillEmoji}>{emoji}</Text>
            {user_ids.length > 1 && (
              <Text style={[styles.reactionPillCount, { color: colors.foreground }]}>
                {user_ids.length}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Reply quote inside a bubble
// ---------------------------------------------------------------------------

function ReplyBubble({
  reply,
  isOwn,
  colors,
  onPress,
}: {
  reply: NonNullable<Message['reply_to']>;
  isOwn: boolean;
  colors: Palette;
  onPress?: () => void;
}) {
  // Reply names get the same per-user color as sender names when the author's
  // id is known; history-built previews omit it and fall back to neutral.
  const ownText = colors.chatOwnBubbleForeground;
  const nameColor = reply.user_id
    ? userNameColor(reply.user_id, colors)
    : isOwn
      ? ownText
      : colors.mutedForeground;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[
        styles.replyBubble,
        {
          backgroundColor: isOwn ? colors.chatReplyBgOwn : colors.chatReplyBgOther,
          borderLeftColor: isOwn ? colors.chatReplyBorderOwn : colors.chatReplyBorderOther,
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[styles.replyName, { color: nameColor, opacity: isOwn ? 0.85 : 1 }]}
      >
        {reply.user_name}
      </Text>
      <Text
        numberOfLines={2}
        style={[
          styles.replyContent,
          { color: isOwn ? ownText : colors.mutedForeground, opacity: isOwn ? 0.8 : 1 },
        ]}
      >
        {reply.content || '📷 Image'}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Rich message text: mentions + links + emoji enlargement + "Read more"
// ---------------------------------------------------------------------------

function RichContent({
  content,
  mentions,
  isOwn,
  colors,
}: {
  content: string;
  mentions: Message['mentions'];
  isOwn: boolean;
  colors: Palette;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const runs = useMemo(() => splitContentForRender(content, mentions), [content, mentions]);

  const textColor = isOwn ? colors.chatOwnBubbleForeground : colors.foreground;
  const mentionColor = isOwn ? colors.chatMentionOwn : colors.chatMention;
  const linkColor = isOwn ? colors.chatOwnBubbleForeground : colors.chatMention;

  const openUrl = useCallback((url: string) => {
    Linking.openURL(url).catch(() => {
      /* ignore un-openable links */
    });
  }, []);

  return (
    <Text
      style={[styles.content, { color: textColor }]}
      numberOfLines={collapsed ? COLLAPSED_LINES : undefined}
      onTextLayout={(e) => {
        const lineCount = e.nativeEvent.lines.length;
        setTruncated(collapsed && lineCount >= COLLAPSED_LINES);
      }}
    >
      {runs.map((run, i) => {
        if (run.kind === 'mention') {
          return (
            <Text key={i} style={[styles.mentionText, { color: mentionColor }]}>
              {run.text}
            </Text>
          );
        }
        if (run.kind === 'url') {
          return (
            <Text
              key={i}
              style={{ color: linkColor, textDecorationLine: 'underline' }}
              onPress={() => openUrl(run.url)}
            >
              {run.text}
            </Text>
          );
        }
        return <Fragment key={i}>{run.text}</Fragment>;
      })}
      {truncated && collapsed && (
        <Text>
          {'\u2060… '}
          <Text
            style={[
              styles.readMore,
              { color: isOwn ? colors.chatOwnBubbleForeground : colors.mutedForeground },
            ]}
            onPress={() => setCollapsed(false)}
            suppressHighlighting
          >
            Read more
          </Text>
        </Text>
      )}
    </Text>
  );
}

// ---------------------------------------------------------------------------
// Media inside a bubble
// ---------------------------------------------------------------------------

const MEDIA_MAX_WIDTH = 240;
const MEDIA_MAX_HEIGHT = 300;
const MEDIA_MIN_HEIGHT = 90;

function BubbleImage({
  uri,
  isOwn,
  standalone,
  dimmed,
  createdAt,
  showStatus,
  onPress,
  onLongPress,
}: {
  uri: string;
  isOwn: boolean;
  standalone: boolean;
  dimmed: boolean;
  createdAt: string;
  showStatus: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const [ratio, setRatio] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    Image.getSize(
      uri,
      (w, h) => {
        if (!cancelled && w > 0 && h > 0) setRatio(w / h);
      },
      () => {
        /* keep the 4:3 fallback */
      },
    );
    return () => {
      cancelled = true;
    };
  }, [uri]);

  const aspect = ratio ?? 4 / 3;
  let width = MEDIA_MAX_WIDTH;
  let height = MEDIA_MAX_WIDTH / aspect;
  if (height > MEDIA_MAX_HEIGHT) {
    height = MEDIA_MAX_HEIGHT;
    width = MEDIA_MAX_HEIGHT * aspect;
  }
  if (height < MEDIA_MIN_HEIGHT) {
    height = MEDIA_MIN_HEIGHT;
    width = Math.min(MEDIA_MIN_HEIGHT * aspect, MEDIA_MAX_WIDTH);
  }

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      accessibilityLabel="View full image"
      accessibilityRole="button"
      style={[standalone ? styles.mediaStandalone : styles.mediaInBubble, { width, height }]}
    >
      <Image
        source={{ uri }}
        style={{ width: '100%', height: '100%', opacity: dimmed ? 0.5 : 1 }}
        resizeMode="cover"
      />
      {standalone && showStatus && (
        <View style={[styles.mediaTimeOverlay, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
          <Text style={styles.mediaTimeText}>{fmtTime(createdAt)}</Text>
          {isOwn && (
            <Ionicons name="checkmark-done-sharp" size={11} color="rgba(255,255,255,0.9)" />
          )}
        </View>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Send-status chrome
// ---------------------------------------------------------------------------

function RetryIndicator({ onRetry, colors }: { onRetry: () => void; colors: Palette }) {
  return (
    <View style={styles.retryCol}>
      <Pressable
        onPress={onRetry}
        hitSlop={8}
        accessibilityLabel="Retry sending"
        style={styles.retryBtn}
      >
        <Ionicons name="refresh" size={13} color="#FFFFFF" />
      </Pressable>
      <Text style={[styles.retryText, { color: colors.destructive }]}>Retry</Text>
    </View>
  );
}

function TimeRow({
  message,
  isOwn,
  colors,
}: {
  message: Message;
  isOwn: boolean;
  colors: Palette;
}) {
  const status = message.status;
  const timeColor = isOwn ? colors.chatOwnBubbleForeground : colors.mutedForeground;
  const opacity = isOwn ? 0.6 : 1;

  return (
    <View style={styles.timeRow}>
      {!!message.edited_at && (
        <Text
          style={[
            styles.timeText,
            { color: timeColor, opacity: isOwn ? 0.5 : 1, marginRight: 2 },
          ]}
        >
          edited
        </Text>
      )}
      <Text style={[styles.timeText, { color: timeColor, opacity }]}>
        {fmtTime(message.created_at)}
      </Text>
      {isOwn && status === 'sending' && (
        <ActivityIndicator size="small" color={timeColor} style={styles.tinySpinner} />
      )}
      {isOwn && (status === 'sent' || !status) && (
        <Ionicons name="checkmark-done-sharp" size={11} color={timeColor} style={{ opacity: 0.7 }} />
      )}
      {isOwn && status === 'failed' && (
        <Text style={[styles.timeText, { color: colors.destructive }]}>!</Text>
      )}
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
  currentUserId,
  onLongPress,
  onReactionPress,
  onImagePress,
  onCancel,
  onRetry,
  onReplyPress,
}: Props) {
  const colors = useColors();
  const { width: screenWidth } = useWindowDimensions();

  const sender = message.users;
  const senderName = sender?.name ?? (isOwn ? 'You' : 'Unknown');
  const reactions = message.reactions ?? [];
  const replyTo = message.reply_to ?? null;
  const imageUrl = message.image_url ?? null;
  const failed = message.status === 'failed';
  const uploading = message.status === 'sending' && !!imageUrl;
  const isDeleted = !!message.deleted_at;
  const imageOnly = !!imageUrl && !message.content && !replyTo;
  const isFirstInGroup = !isSameAuthor;
  const showHeader = !isSameAuthor;

  const bubbleMaxWidth = Math.min(screenWidth * 0.78, 420);

  // Big bubble-free emoji when the whole message is 1–3 emoji glyphs.
  const isEmojiMsg =
    !isDeleted && !imageUrl && !replyTo && !!message.content && isEmojiOnly(message.content);

  const ownBubbleColor = failed ? colors.chatFailedBubble : colors.chatOwnBubble;
  const bubbleBg = isOwn ? ownBubbleColor : colors.surfaceRaised;
  const tailColor = isOwn ? ownBubbleColor : colors.surfaceRaised;

  const senderColor = userNameColor(message.user_id, colors);
  const ownText = colors.chatOwnBubbleForeground;
  const textColor = isOwn ? ownText : colors.foreground;

  const handlePress = useCallback(() => {
    if (isOwn && failed) onRetry?.(message.id);
  }, [isOwn, failed, onRetry, message.id]);

  const handleLongPress = useCallback(() => {
    if (isDeleted) return;
    // The press must register in the hand at the moment the action sheet
    // slides up, which is exactly when the long-press timer fires.
    hapticImpact();
    onLongPress(message);
  }, [isDeleted, onLongPress, message]);

  return (
    <View
      style={[
        styles.row,
        { justifyContent: isOwn ? 'flex-end' : 'flex-start' },
        isFirstInGroup ? styles.rowFirst : styles.rowCompact,
      ]}
    >
      {/* Avatar column — hidden for own messages (web parity) */}
      {!isOwn && (
        <View style={styles.avatarCol}>
          {showHeader && (
            <Avatar name={senderName} avatarUrl={sender?.avatar_url ?? null} colors={colors} />
          )}
        </View>
      )}

      {/* Content column */}
      <View style={[styles.contentCol, { maxWidth: bubbleMaxWidth }]}>
        {!isDeleted && isEmojiMsg ? (
          <View
            style={[
              styles.bubbleRow,
              isOwn ? styles.bubbleRowOwn : styles.bubbleRowOther,
            ]}
          >
            <View style={styles.bubbleWrap}>
              <View style={styles.emojiWrap}>
                <Text style={styles.bigEmoji}>{message.content}</Text>
                <TimeRow message={message} isOwn={isOwn} colors={colors} />
              </View>
              <ReactionPills
                reactions={reactions}
                currentUserId={currentUserId}
                messageId={message.id}
                onReactionPress={onReactionPress}
                colors={colors}
              />
            </View>
          </View>
        ) : (
          <View
            style={[
              styles.bubbleRow,
              isOwn ? styles.bubbleRowOwn : styles.bubbleRowOther,
            ]}
          >
            {failed && <RetryIndicator onRetry={() => onRetry?.(message.id)} colors={colors} />}

            <View style={styles.bubbleWrap}>
              <Pressable
                onPress={handlePress}
                onLongPress={handleLongPress}
                delayLongPress={350}
                style={[
                  styles.bubble,
                  imageUrl ? styles.bubbleMedia : styles.bubbleText,
                  {
                    backgroundColor: bubbleBg,
                    shadowColor: '#000',
                  },
                  isFirstInGroup &&
                    (isOwn ? styles.bubbleFirstOwn : styles.bubbleFirstOther),
                ]}
              >
                {isFirstInGroup && <MessageBubbleTail side={isOwn ? 'right' : 'left'} color={tailColor} />}

                {/* Sender name inside the bubble, WhatsApp-style. Own messages
                    skip it, matching WhatsApp and the web app. */}
                {!isOwn && showHeader && !isDeleted && (
                  <Text
                    style={[styles.senderName, { color: senderColor }, imageUrl ? styles.nameOnMedia : null]}
                  >
                    {senderName}
                  </Text>
                )}

                {isDeleted ? (
                  <Fragment>
                    <View style={styles.deletedRow}>
                      <Ionicons name="ban" size={13} color={isOwn ? ownText : colors.mutedForeground} />
                      <Text
                        style={[
                          styles.deletedText,
                          { color: isOwn ? ownText : colors.mutedForeground },
                        ]}
                      >
                        {isOwn ? 'You deleted this message' : 'This message was deleted'}
                      </Text>
                    </View>
                    <View style={styles.timeRow}>
                      <Text
                        style={[
                          styles.timeText,
                          { color: isOwn ? ownText : colors.mutedForeground, opacity: isOwn ? 0.6 : 1 },
                        ]}
                      >
                        {fmtTime(message.created_at)}
                      </Text>
                    </View>
                  </Fragment>
                ) : (
                  <Fragment>
                    {replyTo && (
                      <ReplyBubble
                        reply={replyTo}
                        isOwn={isOwn}
                        colors={colors}
                        onPress={onReplyPress ? () => onReplyPress(replyTo.id) : undefined}
                      />
                    )}

                    {imageUrl && (
                      <BubbleImage
                        uri={imageUrl}
                        isOwn={isOwn}
                        standalone={imageOnly}
                        dimmed={uploading || failed}
                        createdAt={message.created_at}
                        showStatus={!uploading && !failed}
                        onPress={() => onImagePress?.(imageUrl)}
                        onLongPress={handleLongPress}
                      />
                    )}

                    {!!message.content && (
                      <View style={imageUrl ? styles.contentOnMedia : null}>
                        <RichContent
                          content={message.content}
                          mentions={message.mentions}
                          isOwn={isOwn}
                          colors={colors}
                        />
                      </View>
                    )}

                    {!imageOnly && (
                      <View style={imageUrl ? styles.timeRowOnMedia : null}>
                        <TimeRow message={message} isOwn={isOwn} colors={colors} />
                      </View>
                    )}

                    {/* Uploading overlay — spinner ring + cancel (web parity) */}
                    {isOwn && uploading && (
                      <View style={styles.statusOverlay} pointerEvents="box-none">
                        <View style={styles.spinnerRing} pointerEvents="none">
                          <ActivityIndicator size="large" color="#FFFFFF" />
                          <Pressable
                            onPress={() => onCancel?.(message.id)}
                            hitSlop={12}
                            style={styles.cancelCircle}
                            accessibilityLabel="Cancel upload"
                          >
                            <Ionicons name="close" size={14} color="#FFFFFF" />
                          </Pressable>
                        </View>
                      </View>
                    )}
                  </Fragment>
                )}
              </Pressable>

              <ReactionPills
                reactions={reactions}
                currentUserId={currentUserId}
                messageId={message.id}
                onReactionPress={onReactionPress}
                colors={colors}
              />
            </View>
          </View>
        )}

        {/* Reserve room for the pills that hang below the bubble */}
        {reactions.length > 0 && !isDeleted && <View style={styles.reactionSpacer} />}
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
    paddingHorizontal: 16,
    gap: 8,
  },
  rowFirst: { marginTop: 12 },
  rowCompact: { marginTop: 2 },

  avatarCol: { width: 28, flexShrink: 0 },
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarText: { fontSize: 11, fontFamily: 'Geist_600SemiBold' },

  contentCol: { flexShrink: 1, minWidth: 0 },

  bubbleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bubbleRowOwn: { flexDirection: 'row-reverse' },
  bubbleRowOther: { flexDirection: 'row' },

  bubbleWrap: { position: 'relative', minWidth: 0 },

  bubble: {
    borderRadius: 10,
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  bubbleFirstOwn: { borderTopRightRadius: 0 },
  bubbleFirstOther: { borderTopLeftRadius: 0 },
  bubbleText: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6 },
  // Media bubbles keep a thin frame around the image (WhatsApp-style).
  bubbleMedia: { padding: 4 },

  senderName: {
    fontSize: 12,
    lineHeight: 16,
    fontFamily: 'Geist_600SemiBold',
    marginBottom: 2,
  },
  nameOnMedia: { marginBottom: 4, paddingLeft: 4 },

  content: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: 'Geist_400Regular',
  },
  mentionText: { fontFamily: 'Geist_600SemiBold' },
  readMore: { fontSize: 15, fontFamily: 'Geist_500Medium' },
  contentOnMedia: { paddingLeft: 4, paddingRight: 4 },

  // ── reply quote ─────────────────────────────────────────────────────────
  replyBubble: {
    borderLeftWidth: 2,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 4,
    maxWidth: '100%',
  },
  replyName: { fontSize: 10, fontFamily: 'Geist_600SemiBold', lineHeight: 14 },
  replyContent: { fontSize: 11, lineHeight: 15 },

  // ── media ───────────────────────────────────────────────────────────────
  mediaStandalone: { borderRadius: 8, overflow: 'hidden', position: 'relative' },
  mediaInBubble: { borderRadius: 8, overflow: 'hidden', position: 'relative' },
  mediaTimeOverlay: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  mediaTimeText: { fontSize: 10, fontFamily: 'Geist_400Regular', color: 'rgba(255,255,255,0.9)' },

  // ── time row ────────────────────────────────────────────────────────────
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 1,
  },
  timeRowOnMedia: { paddingRight: 4, paddingBottom: 2 },
  timeText: { fontSize: 10, fontFamily: 'Geist_400Regular' },
  tinySpinner: { transform: [{ scale: 0.6 }], marginLeft: -2 },

  // ── own-message overlays ────────────────────────────────────────────────
  statusOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerRing: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelCircle: {
    position: 'absolute',
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── retry ───────────────────────────────────────────────────────────────
  retryCol: { alignItems: 'center', gap: 4, flexShrink: 0, alignSelf: 'center' },
  retryBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EF4444',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryText: { fontSize: 9, fontFamily: 'Geist_500Medium', lineHeight: 11 },

  // ── deleted ─────────────────────────────────────────────────────────────
  deletedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deletedText: { fontSize: 12, lineHeight: 22, fontFamily: 'Geist_400Regular', fontStyle: 'italic' },

  // ── big emoji ───────────────────────────────────────────────────────────
  emojiWrap: { alignItems: 'flex-start', paddingHorizontal: 2, paddingBottom: 2 },
  bigEmoji: { fontSize: EMOJI_MESSAGE_SIZE, lineHeight: EMOJI_MESSAGE_SIZE + 8 },

  // ── reactions ───────────────────────────────────────────────────────────
  reactionPills: {
    position: 'absolute',
    bottom: -14,
    left: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: 1,
  },
  reactionPillEmoji: { fontSize: 14 },
  reactionPillCount: { fontSize: 10, fontFamily: 'Geist_500Medium', opacity: 0.7 },
  reactionSpacer: { height: 20 },
});
