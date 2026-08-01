import React, { Fragment, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
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
  onImagePress?: (uri: string) => void;
  currentUserId: string;
  onCancel?: (tempId: string) => void;
  onRetry?: (tempId: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Deterministic hash used to pick a stable DiceBear style per name.
 * Mirrors the same logic in the web AvatarImg component.
 */
function hashName(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return h;
}

const DICEBEAR_STYLES = [
  'bottts', 'fun-emoji', 'pixel-art', 'lorelei', 'micah',
  'croodles', 'adventurer', 'notionists',
] as const;

function dicebearUrl(seed: string): string {
  const style = DICEBEAR_STYLES[hashName(seed) % DICEBEAR_STYLES.length];
  // Use PNG — React Native's <Image> cannot render SVGs natively.
  return `https://api.dicebear.com/9.x/${style}/png?seed=${encodeURIComponent(seed)}`;
}

/**
 * Converts any avatar_url stored in the DB into a plain HTTPS URL that
 * React Native's <Image> can load. React Native cannot render SVGs natively,
 * so all SVG-serving domains are converted to PNG equivalents.
 *
 *   null / ''                            → DiceBear PNG from name
 *   boring://{style}/{encodedSeed}       → DiceBear PNG from decoded seed
 *   https://source.boringavatars.com/…  → DiceBear PNG from URL seed segment
 *   https://api.dicebear.com/…/svg?…    → rewritten to /png?… (same seed)
 *   https://api.multiavatar.com/…       → appended ?format=png
 *   https://avataaars.io/…              → appended &fmt=png (query toggle)
 *   any other https URL (R2 uploads…)   → returned as-is
 */
function resolveAvatarUri(avatarUrl: string | null, name: string): string {
  if (!avatarUrl) {
    return dicebearUrl(name);
  }

  // boring:// protocol — inline SVG on web, convert to DiceBear PNG on mobile
  if (avatarUrl.startsWith('boring://')) {
    const rest = avatarUrl.slice('boring://'.length);
    const slashIdx = rest.indexOf('/');
    const seed = slashIdx >= 0
      ? decodeURIComponent(rest.slice(slashIdx + 1))
      : name;
    return dicebearUrl(seed || name);
  }

  // Legacy boringavatars CDN — web rewrites to DiceBear, we do the same
  if (avatarUrl.startsWith('https://source.boringavatars.com/')) {
    try {
      const parsed = new URL(avatarUrl);
      const [, , , encodedSeed] = parsed.pathname.split('/');
      const seed = encodedSeed ? decodeURIComponent(encodedSeed) : name;
      return dicebearUrl(seed || name);
    } catch {
      return dicebearUrl(name);
    }
  }

  // DiceBear — stored URLs use /svg by default; rewrite path segment to /png
  if (avatarUrl.startsWith('https://api.dicebear.com/')) {
    return avatarUrl.replace(/\/svg(\?|$)/, '/png$1');
  }

  // Multiavatar — returns SVG by default; ?format=png gives a raster image
  if (avatarUrl.startsWith('https://api.multiavatar.com/')) {
    const sep = avatarUrl.includes('?') ? '&' : '?';
    return `${avatarUrl}${sep}format=png`;
  }

  // Avataaars — returns SVG; no official PNG endpoint, use DiceBear fallback
  if (avatarUrl.startsWith('https://avataaars.io/')) {
    return dicebearUrl(name);
  }

  // Robohash and all other HTTPS URLs (R2 uploads, etc.) — load as-is
  return avatarUrl;
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
 *
 * Handles all avatar_url formats stored in the DB:
 *   - null / ''                      → DiceBear generated from name
 *   - boring://{style}/{encodedSeed} → DiceBear (same as web AvatarImg)
 *   - https://source.boringavatars.com/... → DiceBear (legacy seed reuse)
 *   - any other https URL            → loaded directly
 *
 * If even the resolved URL fails to load, falls back to initials.
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
  const resolvedUri = resolveAvatarUri(avatarUrl, name);
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
        { backgroundColor: colors.primarySoft, overflow: 'hidden' },
      ]}
    >
      {!imageError ? (
        <Image
          source={{ uri: resolvedUri }}
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
  onImagePress,
  currentUserId,
  onCancel,
  onRetry,
}: Props) {
  const colors = useColors();

  // Pulse animation for the sending spinner ring
  const spinAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (message.status === 'sending') {
      Animated.loop(
        Animated.timing(spinAnim, { toValue: 1, duration: 900, useNativeDriver: true })
      ).start();
    } else {
      spinAnim.stopAnimation();
      spinAnim.setValue(0);
    }
  }, [message.status, spinAnim]);

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
                <Ionicons name="checkmark-done-sharp" size={15} color={colors.mutedForeground} />
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
        ) : message.image_url && !message.content ? (
          /* ── Image-only: no bubble wrapper, just a bordered image card ── */
          <Fragment>
            <View style={{ alignSelf: 'flex-start' }}>
              <Pressable
                onPress={() => message.status !== 'sending' && message.status !== 'failed' && onImagePress?.(message.image_url!)}
                onLongPress={() => onLongPress(message)}
                delayLongPress={350}
                accessibilityLabel="View full image"
                accessibilityRole="button"
                style={[styles.imageCard, { borderColor: colors.primary }]}
              >
                <Image
                  source={{ uri: message.image_url }}
                  style={[
                    styles.messageImage,
                    (message.status === 'sending' || message.status === 'failed') && { opacity: 0.45 },
                  ]}
                  resizeMode="cover"
                />
                {(!message.status || message.status === 'sent') && (
                  <View style={styles.imageTimeOverlay}>
                    <Text style={styles.imageTimeText}>
                      {formatTime(message.created_at)}
                    </Text>
                    {isOwn && (
                      <Ionicons
                        name="checkmark-done-sharp"
                        size={13}
                        color="rgba(255,255,255,0.95)"
                      />
                    )}
                  </View>
                )}
              </Pressable>

              {/* Sending overlay — spinner ring + cancel */}
              {isOwn && message.status === 'sending' && (
                <View style={styles.statusOverlay} pointerEvents="box-none">
                  <View style={styles.spinnerRing} pointerEvents="none">
                    <ActivityIndicator size="large" color="rgba(255,255,255,0.9)" />
                  </View>
                  <Pressable
                    onPress={() => onCancel?.(message.id)}
                    style={styles.cancelCircle}
                    hitSlop={10}
                  >
                    <Ionicons name="close" size={18} color="white" />
                  </Pressable>
                </View>
              )}

              {/* Failed overlay — tap to retry */}
              {isOwn && message.status === 'failed' && (
                <Pressable
                  style={styles.statusOverlay}
                  onPress={() => onRetry?.(message.id)}
                >
                  <Ionicons name="reload-outline" size={28} color="white" />
                  <Text style={styles.retryLabel}>Tap to retry</Text>
                </Pressable>
              )}
            </View>
            <ReactionChips
              reactions={message.reactions}
              currentUserId={currentUserId}
              messageId={message.id}
              onReactionPress={onReactionPress}
              colors={colors}
            />
          </Fragment>
        ) : message.image_url && message.content ? (
          /* ── Image + caption: blue bubble, image flush at top, text below ── */
          <Fragment>
            <View style={{ alignSelf: 'flex-start' }}>
              <Pressable
                onLongPress={() => onLongPress(message)}
                delayLongPress={350}
                style={[
                  styles.bubble,
                  styles.bubbleImageCaption,
                  {
                    backgroundColor: isOwn ? colors.primary : colors.card,
                    borderColor: isOwn ? 'transparent' : colors.border,
                    opacity: (message.status === 'sending' || message.status === 'failed') ? 0.55 : 1,
                  },
                ]}
              >
                <Pressable
                  onPress={() => message.status !== 'sending' && message.status !== 'failed' && onImagePress?.(message.image_url!)}
                  onLongPress={() => onLongPress(message)}
                  delayLongPress={350}
                  accessibilityLabel="View full image"
                  accessibilityRole="button"
                >
                  <Image
                    source={{ uri: message.image_url }}
                    style={styles.captionImage}
                    resizeMode="cover"
                  />
                </Pressable>
                <View style={styles.captionPadding}>
                  <Text
                    style={[
                      styles.content,
                      { color: isOwn ? colors.primaryForeground : colors.foreground },
                    ]}
                  >
                    {message.content}
                  </Text>
                </View>
                <View style={styles.captionTimeRow}>
                  {(!message.status || message.status === 'sent') && (
                    <Text style={[styles.timeText, { color: timeColor }]}>
                      {formatTime(message.created_at)}
                    </Text>
                  )}
                  {isOwn && (!message.status || message.status === 'sent') && (
                    <Ionicons name="checkmark-done-sharp" size={15} color={timeColor} />
                  )}
                  {message.status === 'sending' && (
                    <ActivityIndicator size="small" color={timeColor} />
                  )}
                  {isOwn && message.status === 'failed' && (
                    <Ionicons name="warning-outline" size={15} color="rgba(255,100,100,0.9)" />
                  )}
                </View>
              </Pressable>

              {/* Sending overlay */}
              {isOwn && message.status === 'sending' && (
                <View style={[styles.statusOverlay, { borderRadius: 16 }]} pointerEvents="box-none">
                  <View style={styles.spinnerRing} pointerEvents="none">
                    <ActivityIndicator size="large" color="rgba(255,255,255,0.9)" />
                  </View>
                  <Pressable
                    onPress={() => onCancel?.(message.id)}
                    style={styles.cancelCircle}
                    hitSlop={10}
                  >
                    <Ionicons name="close" size={18} color="white" />
                  </Pressable>
                </View>
              )}

              {/* Failed overlay */}
              {isOwn && message.status === 'failed' && (
                <Pressable
                  style={[styles.statusOverlay, { borderRadius: 16 }]}
                  onPress={() => onRetry?.(message.id)}
                >
                  <Ionicons name="reload-outline" size={28} color="white" />
                  <Text style={styles.retryLabel}>Tap to retry</Text>
                </Pressable>
              )}
            </View>
            <ReactionChips
              reactions={message.reactions}
              currentUserId={currentUserId}
              messageId={message.id}
              onReactionPress={onReactionPress}
              colors={colors}
            />
          </Fragment>
        ) : (
          /* ── Text-only bubble ── */
          <Fragment>
            <Pressable
              onLongPress={() => onLongPress(message)}
              onPress={isOwn && message.status === 'failed' ? () => onRetry?.(message.id) : undefined}
              delayLongPress={350}
              style={[
                styles.bubble,
                {
                  backgroundColor: isOwn ? colors.primary : colors.card,
                  borderColor: isOwn ? 'transparent' : colors.border,
                  opacity: message.status === 'sending' ? 0.65 : 1,
                },
              ]}
            >
              {message.reply_to && !message.reply_to.id.startsWith('deleted') && (
                <ReplyPreview replyTo={message.reply_to} colors={colors} />
              )}
              <Text
                style={[
                  styles.content,
                  { color: isOwn ? colors.primaryForeground : colors.foreground },
                ]}
              >
                {message.content}
              </Text>
              <View style={styles.timeRow}>
                {(!message.status || message.status === 'sent') && (
                  <Text style={[styles.timeText, { color: timeColor }]}>
                    {formatTime(message.created_at)}
                  </Text>
                )}
                {isOwn && (!message.status || message.status === 'sent') && (
                  <Ionicons name="checkmark-done-sharp" size={15} color={timeColor} />
                )}
                {message.status === 'sending' && (
                  <ActivityIndicator size="small" color={timeColor} />
                )}
                {isOwn && message.status === 'failed' && (
                  <>
                    <Ionicons name="warning-outline" size={14} color="rgba(255,120,120,0.9)" />
                    <Text style={[styles.timeText, { color: 'rgba(255,120,120,0.9)' }]}>
                      Tap to retry
                    </Text>
                  </>
                )}
              </View>
            </Pressable>
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

  // Image-only: standalone pressable card — 2px border, no outer bubble
  imageCard: {
    borderRadius: 14,
    borderWidth: 2,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  messageImage: {
    width: 220,
    height: 160,
  },

  // Image+caption bubble modifier — zero padding so image sits flush at top
  bubbleImageCaption: {
    padding: 0,
    overflow: 'hidden',
  },
  // Image inside an image+caption bubble — full width, no border (bubble provides the shape)
  captionImage: {
    width: 220,
    height: 160,
  },
  imageTimeOverlay: {
    position: 'absolute',
    bottom: 6,
    right: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  imageTimeText: {
    color: 'rgba(255,255,255,0.95)',
    fontSize: 10,
    fontFamily: 'Geist_400Regular',
  },

  // Padding wrapper for caption text that follows an image
  // (bubble padding is zeroed for images, so we re-add it here)
  captionPadding: {
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  // Time row shown below caption on image+text messages
  captionTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 3,
    paddingHorizontal: 12,
    paddingBottom: 6,
    marginTop: 2,
  },

  content: {
    fontSize: 16,
    fontFamily: 'Geist_400Regular',
    lineHeight: 24,
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

  // ── send-status overlays ──────────────────────────────────────────────────

  /** Fills the image card; hosts the spinner+cancel or retry UI. */
  statusOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },

  /** Transparent ring that sits behind the ActivityIndicator. */
  spinnerRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },

  /** The × button centred inside the spinner ring. */
  cancelCircle: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  retryLabel: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 11,
    fontFamily: 'Geist_500Medium',
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
