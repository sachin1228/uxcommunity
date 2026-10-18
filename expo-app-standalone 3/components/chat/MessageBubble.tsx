import React, { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Linking,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useColors } from '@/hooks/useColors';
import { Message, Reaction } from '@/lib/communities';
import { hapticImpact, hapticSelection } from '@/lib/haptics';
import { PersonAvatar } from '@/components/PersonAvatar';
import { CHAT_CONTENT_KIND_THEME } from '@/lib/chatContentEvents';
import {
  COLLAPSED_LINES,
  fmtTime,
  isEmojiOnly,
  splitContentForRender,
  userNameColor,
} from '@/lib/chat';
import { MessageBubbleTail } from './MessageBubbleTail';
import { CheckCheckIcon } from './CheckCheckIcon';

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
  /** Opens the sender's read-only member profile (avatar / name tap). */
  onAuthorPress?: (userId: string) => void;
  onImagePress?: (uri: string) => void;
  onCancel?: (tempId: string) => void;
  onRetry?: (tempId: string) => void;
  /** Jumps the list to the message this one replies to. */
  onReplyPress?: (messageId: string) => void;
  /** Jumps the list to the "created a …" card this one replies to. */
  onContentReplyPress?: (contentId: string) => void;
  /** Swiping the bubble away from its edge starts a reply (WhatsApp-style). */
  onSwipeReply?: (message: Message) => void;
  /** Row focus flash after a reply jump (web parity) — fades a blue tint in/out. */
  highlighted?: boolean;
}

type Palette = ReturnType<typeof useColors>;

const EMOJI_MESSAGE_SIZE = 48;
/** Max bubble travel during a reply swipe, and the release distance that fires it. */
const SWIPE_TRAVEL = 80;
const SWIPE_THRESHOLD = 56;

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
  currentUserId,
  onPress,
}: {
  reply: NonNullable<Message['reply_to']>;
  isOwn: boolean;
  colors: Palette;
  currentUserId: string;
  onPress?: () => void;
}) {
  // Reply names get the same per-user color as sender names when the author's
  // id is known — except a quote of your own message stays neutral white.
  // History-built previews omit the id and fall back to neutral too.
  const ownText = colors.chatOwnBubbleForeground;
  const quotedSelf = !!reply.user_id && reply.user_id === currentUserId;
  const nameColor = reply.user_id && !quotedSelf
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
        { backgroundColor: isOwn ? colors.chatReplyBgOwn : colors.chatReplyBgOther },
      ]}
    >
      {/* Short rounded rule, WhatsApp-style — the author's color when known. */}
      <View
        style={[
          styles.replyBar,
          {
            backgroundColor: reply.user_id && !quotedSelf
              ? nameColor
              : isOwn
                ? colors.chatReplyBorderOwn
                : colors.chatReplyBorderOther,
          },
        ]}
      />
      <View style={styles.replyBody}>
        <Text
          numberOfLines={1}
          style={[styles.replyName, { color: nameColor }]}
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
      </View>
    </Pressable>
  );
}

/**
 * Reply quote for a "created a …" notification card (thread / showcase /
 * resource / event) — the web ContentReplyBubble: same chip as a message
 * reply, but the first line wears the kind's label so the anchor is obvious,
 * and tapping jumps to the card.
 */
function ContentReplyQuote({
  reply,
  isOwn,
  colors,
  onPress,
}: {
  reply: NonNullable<Message['reply_to_content']>;
  isOwn: boolean;
  colors: Palette;
  onPress?: () => void;
}) {
  const ownText = colors.chatOwnBubbleForeground;
  const label = CHAT_CONTENT_KIND_THEME[reply.kind].label;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={[
        styles.replyBubble,
        { backgroundColor: isOwn ? colors.chatReplyBgOwn : colors.chatReplyBgOther },
      ]}
    >
      <View
        style={[
          styles.replyBar,
          {
            backgroundColor: isOwn
              ? colors.chatReplyBorderOwn
              : colors.chatReplyBorderOther,
          },
        ]}
      />
      <View style={styles.replyBody}>
        <Text
          numberOfLines={1}
          style={[
            styles.contentReplyLabel,
            { color: isOwn ? ownText : colors.mutedForeground, opacity: isOwn ? 0.8 : 1 },
          ]}
        >
          {label}
        </Text>
        <Text
          numberOfLines={2}
          style={[
            styles.replyContent,
            { color: isOwn ? ownText : colors.mutedForeground, opacity: isOwn ? 0.7 : 1 },
          ]}
        >
          {reply.title || label}
        </Text>
      </View>
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
    <View>
      <Text
        style={[styles.content, { color: textColor }]}
        numberOfLines={collapsed ? COLLAPSED_LINES : undefined}
        onTextLayout={(e) => {
          if (!collapsed) return;
          const lineCount = e.nativeEvent.lines.length;
          setTruncated(lineCount >= COLLAPSED_LINES);
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
      </Text>
      {/* The affordance must sit outside the clamped Text — appended inside it,
          it was itself clipped by numberOfLines and never visible. Same pattern
          as CollapsibleBody in the community feed. */}
      {truncated && collapsed && (
        <Pressable
          onPress={(event) => {
            event.stopPropagation();
            hapticSelection();
            setCollapsed(false);
          }}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Read more"
        >
          <Text
            style={[
              styles.readMore,
              { color: isOwn ? colors.chatOwnBubbleForeground : colors.mutedForeground },
            ]}
          >
            Read more
          </Text>
        </Pressable>
      )}
    </View>
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
  // The frame's aspect, measured from the loaded image itself (expo-image's
  // onLoad carries the source dimensions) — the old Image.getSize round trip
  // is gone; until it lands, the 4:3 fallback holds the layout.
  const [ratio, setRatio] = useState<number | null>(null);

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
        contentFit="cover"
        onLoad={({ source }) => {
          const w = source?.width ?? 0;
          const h = source?.height ?? 0;
          if (w > 0 && h > 0) setRatio(w / h);
        }}
      />
      {standalone && showStatus && (
        <View style={[styles.mediaTimeOverlay, { backgroundColor: 'rgba(0,0,0,0.55)' }]}>
          <Text style={styles.mediaTimeText}>{fmtTime(createdAt)}</Text>
          {isOwn && (
            <CheckCheckIcon size={11} color="rgba(255,255,255,0.9)" />
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
        // The spinner sits in the check mark's exact 11pt slot (scaled to fit):
        // an ActivityIndicator's unscaled box is ~20pt and a transform does
        // not shrink layout, so without the slot the row widened while
        // sending and snapped back when the double check appeared.
        <View style={styles.statusSlot}>
          <ActivityIndicator size="small" color={timeColor} style={styles.tinySpinner} />
        </View>
      )}
      {isOwn && (status === 'sent' || !status) && (
        <CheckCheckIcon size={11} color={timeColor} opacity={0.7} />
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

/**
 * Memoized like the web MessageBubble: chat-screen state changes that do not
 * touch this message — the typing indicator ticking, presence, the emoji
 * panel — must not re-render every visible bubble. All props are stable
 * between such changes (message objects only change when the row does).
 */
export const MessageBubble = memo(function MessageBubble({
  message,
  isOwn,
  isSameAuthor,
  currentUserId,
  onLongPress,
  onReactionPress,
  onAuthorPress,
  onImagePress,
  onCancel,
  onRetry,
  onReplyPress,
  onContentReplyPress,
  onSwipeReply,
  highlighted = false,
}: Props) {
  const colors = useColors();
  const { width: screenWidth } = useWindowDimensions();

  // Row focus flash — the web row's translucent blue, faded like its
  // `transition-colors` rather than popping on and off.
  const flash = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(flash, {
      toValue: highlighted ? 1 : 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [highlighted, flash]);
  const flashStyle = {
    backgroundColor: flash.interpolate({
      inputRange: [0, 1],
      outputRange: ['rgba(0, 98, 209, 0)', 'rgba(0, 98, 209, 0.25)'],
    }),
  };

  // Swipe-to-reply: the bubble slides away from the edge it's anchored to —
  // right for other people's messages, left for your own — revealing a reply
  // arrow, as WhatsApp does. Vertical-dominant drags stay with the list.
  const swipeX = useRef(new Animated.Value(0)).current;
  const swipeProgress = useRef(new Animated.Value(0)).current;
  const swipeCrossed = useRef(false);
  const swipeEnabled = !message.deleted_at && !message.id.startsWith('temp-') && !!onSwipeReply;

  const resetSwipe = useCallback(() => {
    swipeCrossed.current = false;
    Animated.spring(swipeX, {
      toValue: 0,
      useNativeDriver: true,
      speed: 20,
      bounciness: 0,
    }).start();
    Animated.timing(swipeProgress, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [swipeProgress, swipeX]);

  const swipePan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        // Capture claims the drag even while a child Pressable holds the touch.
        onMoveShouldSetPanResponderCapture: (_, g) => {
          if (!swipeEnabled) return false;
          const outward = isOwn ? -g.dx : g.dx;
          return outward > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5;
        },
        onPanResponderMove: (_, g) => {
          const outward = Math.max(0, isOwn ? -g.dx : g.dx);
          const travel = Math.min(outward, SWIPE_TRAVEL);
          swipeX.setValue(isOwn ? -travel : travel);
          swipeProgress.setValue(Math.min(outward / SWIPE_THRESHOLD, 1));
          const crossed = outward >= SWIPE_THRESHOLD;
          if (crossed && !swipeCrossed.current) hapticSelection();
          swipeCrossed.current = crossed;
        },
        onPanResponderRelease: (_, g) => {
          const outward = Math.max(0, isOwn ? -g.dx : g.dx);
          if (outward >= SWIPE_THRESHOLD) {
            hapticImpact();
            onSwipeReply?.(message);
          }
          resetSwipe();
        },
        onPanResponderTerminate: resetSwipe,
        onPanResponderTerminationRequest: () => false,
      }),
    [isOwn, message, onSwipeReply, resetSwipe, swipeEnabled, swipeProgress, swipeX],
  );

  const sender = message.users;
  const senderName = sender?.name ?? (isOwn ? 'You' : 'Unknown');
  const reactions = message.reactions ?? [];
  const replyTo = message.reply_to ?? null;
  const replyToContent = message.reply_to_content ?? null;
  const imageUrl = message.image_url ?? null;
  const failed = message.status === 'failed';
  const uploading = message.status === 'sending' && !!imageUrl;
  const isDeleted = !!message.deleted_at;
  const imageOnly = !!imageUrl && !message.content && !replyTo && !replyToContent;
  const isFirstInGroup = !isSameAuthor;
  const showHeader = !isSameAuthor;

  const bubbleMaxWidth = Math.min(screenWidth * 0.78, 420);

  // Big bubble-free emoji when the whole message is 1–3 emoji glyphs.
  const isEmojiMsg =
    !isDeleted &&
    !imageUrl &&
    !replyTo &&
    !replyToContent &&
    !!message.content &&
    isEmojiOnly(message.content);

  const ownBubbleColor = failed ? colors.chatFailedBubble : colors.chatOwnBubble;
  const bubbleBg = isOwn ? ownBubbleColor : colors.surfaceRaised;
  const tailColor = isOwn ? ownBubbleColor : colors.surfaceRaised;

  const senderColor = userNameColor(message.user_id, colors);
  const ownText = colors.chatOwnBubbleForeground;
  const textColor = isOwn ? ownText : colors.foreground;

  const handlePress = useCallback(() => {
    if (!isOwn || !failed) return;
    hapticSelection();
    onRetry?.(message.id);
  }, [isOwn, failed, onRetry, message.id]);

  const handleLongPress = useCallback(() => {
    if (isDeleted) return;
    // The press must register in the hand at the moment the action sheet
    // slides up, which is exactly when the long-press timer fires.
    hapticImpact();
    onLongPress(message);
  }, [isDeleted, onLongPress, message]);

  const handleAuthorPress = useCallback(() => {
    onAuthorPress?.(message.user_id);
  }, [onAuthorPress, message.user_id]);

  return (
    <Animated.View
      // The whole row is the swipe surface: the avatar column and the empty
      // half beside a short bubble belong to the row, not the content column.
      {...swipePan.panHandlers}
      style={[
        styles.row,
        { justifyContent: isOwn ? 'flex-end' : 'flex-start' },
        isFirstInGroup ? styles.rowFirst : styles.rowCompact,
        flashStyle,
      ]}
    >
      {/* Avatar column — hidden for own messages (web parity) */}
      {!isOwn && (
        <View style={styles.avatarCol}>
          {showHeader && (
            <Pressable
              onPress={handleAuthorPress}
              disabled={!onAuthorPress}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`View ${senderName}'s profile`}
            >
              <PersonAvatar name={senderName} url={sender?.avatar_url ?? null} size={28} />
            </Pressable>
          )}
        </View>
      )}

      {/* Swipe cue, revealed from the edge the bubble slides away from */}
      {swipeEnabled && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.swipeReplyCue,
            isOwn ? styles.swipeReplyCueOwn : styles.swipeReplyCueOther,
            {
              opacity: swipeProgress,
              transform: [
                {
                  scale: swipeProgress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.6, 1],
                  }),
                },
              ],
            },
          ]}
        >
          <Ionicons
            name={isOwn ? 'arrow-redo' : 'arrow-undo'}
            size={20}
            color={colors.mutedForeground}
          />
        </Animated.View>
      )}

      {/* Content column */}
      <Animated.View
        style={[
          styles.contentCol,
          { maxWidth: bubbleMaxWidth },
          { transform: [{ translateX: swipeX }] },
        ]}
      >
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
                    skip it, matching WhatsApp and the web app. Tapping it (or
                    the avatar) opens the sender's profile. */}
                {!isOwn && showHeader && !isDeleted && (
                  <Pressable
                    onPress={handleAuthorPress}
                    disabled={!onAuthorPress}
                    hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
                    accessibilityRole="button"
                    accessibilityLabel={`View ${senderName}'s profile`}
                    style={styles.senderNamePressable}
                  >
                    <Text
                      style={[styles.senderName, { color: senderColor }, imageUrl ? styles.nameOnMedia : null]}
                    >
                      {senderName}
                    </Text>
                  </Pressable>
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
                        currentUserId={currentUserId}
                        onPress={onReplyPress ? () => onReplyPress(replyTo.id) : undefined}
                      />
                    )}

                    {!replyTo && replyToContent && (
                      <ContentReplyQuote
                        reply={replyToContent}
                        isOwn={isOwn}
                        colors={colors}
                        onPress={
                          onContentReplyPress
                            ? () => onContentReplyPress(replyToContent.id)
                            : undefined
                        }
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
      </Animated.View>
    </Animated.View>
  );
});

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

  contentCol: { flexShrink: 1, minWidth: 0 },

  swipeReplyCue: { position: 'absolute', top: 0, bottom: 0, justifyContent: 'center' },
  // The bubble's origin: row padding (16) + avatar column (28) + gap (8).
  swipeReplyCueOther: { left: 52 },
  swipeReplyCueOwn: { right: 16 },

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
  /** Constrains the tap target to the name itself, not the bubble's width. */
  senderNamePressable: { alignSelf: 'flex-start' },
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
    flexDirection: 'row',
    // Web's chip: rounded-md all around — the bar clipping into the left
    // curve is what makes the bar-side corners read tighter.
    borderRadius: 8,
    paddingRight: 10,
    marginBottom: 4,
    maxWidth: '100%',
    gap: 8,
    overflow: 'hidden',
  },
  /** WhatsApp's accent — a full-height square bar, clipped into the chip's
   *  corners by the overflow above (their exact DOM pattern). */
  replyBar: { width: 4, flexShrink: 0 },
  replyBody: { flexShrink: 1, minWidth: 0, paddingVertical: 6 },
  replyName: { fontSize: 10, fontFamily: 'Geist_600SemiBold', lineHeight: 14 },
  contentReplyLabel: { fontSize: 10, fontFamily: 'Geist_600SemiBold', lineHeight: 14, letterSpacing: 0.3 },
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
  /** The check mark's exact box — the sending spinner renders inside it. */
  statusSlot: { width: 11, height: 11, alignItems: 'center', justifyContent: 'center' },
  tinySpinner: { transform: [{ scale: 0.55 }] },

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
