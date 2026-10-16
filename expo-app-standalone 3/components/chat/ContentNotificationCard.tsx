import React from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { fmtTime, userNameColor } from '@/lib/chat';
import {
  CHAT_CONTENT_KIND_THEME,
  firstLine,
  fmtEventSchedule,
  prettyUrl,
  splitBody,
  viewerZoneLabel,
  withArticle,
  type ChatContentEvent,
} from '@/lib/chatContentEvents';
import { RESOURCE_TYPE_LABELS } from '@/lib/communityContent';
import { Avatar } from './MessageBubble';
import { MessageBubbleTail } from './MessageBubbleTail';
import { ContentIcon, type ContentIconName } from './ContentIcons';

/**
 * The permanent "John created a …" card in the chat timeline — the React
 * Native port of the web's ContentNotificationBubble. Rendered as a rich
 * preview card inside a WhatsApp-style chat bubble: left-aligned in a raised
 * bubble for other members, right-aligned in the own-message blue for the
 * author. Covers threads, showcase posts, resources and events.
 */

interface Props {
  event: ChatContentEvent;
  isOwn: boolean;
  currentUserId: string;
  /** Open the item behind the card (its community tab). */
  onOpen: (event: ChatContentEvent) => void;
  /** Toggle/replace the current user's emoji reaction on this card. */
  onReaction: (event: ChatContentEvent, emoji: string) => void;
}

type Palette = ReturnType<typeof useColors>;

/** Eyebrow + fallback tile icon per content kind (the web KIND_ICON map). */
const KIND_ICON: Record<ChatContentEvent['kind'], ContentIconName> = {
  thread: 'message-circle',
  showcase: 'sparkles',
  resource: 'file-text',
  event: 'calendar-days',
};

/** Resource-type tile icon map — the web RESOURCE_TILE_ICON (lucide) set. */
const RESOURCE_TILE_ICON: Record<string, ContentIconName> = {
  figma: 'figma',
  article: 'file-text',
  tool: 'wrench',
  video: 'play',
  book: 'book-open',
  font: 'type',
  icon_pack: 'shapes',
  color: 'palette',
  template: 'layout-template',
  inspiration: 'sparkles',
  other: 'package',
};

/** Reaction pills under a card — MessageBubble's pills, grouped like web. */
function ContentReactionPills({
  reactions,
  currentUserId,
  onPress,
  colors,
}: {
  reactions: NonNullable<ChatContentEvent['reactions']>;
  currentUserId: string;
  onPress: (emoji: string) => void;
  colors: Palette;
}) {
  // Collapse repeated emoji groups (server grouping and optimistic writes can
  // briefly disagree) so each emoji renders exactly one pill.
  const grouped = new Map<string, Set<string>>();
  for (const { emoji, user_ids } of reactions) {
    const ids = grouped.get(emoji) ?? new Set<string>();
    for (const id of user_ids) ids.add(id);
    grouped.set(emoji, ids);
  }

  return (
    <View style={styles.reactionPills}>
      {[...grouped].map(([emoji, idSet]) => {
        const iMine = idSet.has(currentUserId);
        return (
          <Pressable
            key={emoji}
            onPress={() => onPress(emoji)}
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
            {idSet.size > 1 && (
              <Text style={[styles.reactionPillCount, { color: colors.foreground }]}>
                {idSet.size}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

export function ContentNotificationCard({
  event,
  isOwn,
  currentUserId,
  onOpen,
  onReaction,
}: Props) {
  const colors = useColors();
  const { width: screenWidth } = useWindowDimensions();

  const theme = CHAT_CONTENT_KIND_THEME[event.kind];
  const meta = event.meta ?? null;
  // The avatar must key off the real display name — "You" is only the label.
  const senderName = event.users?.name ?? 'Someone';
  const name = isOwn ? 'You' : senderName;

  // Thumbnail precedence: real image > video poster > kind icon tile.
  const imageUrl = meta?.image_url ?? null;
  const posterUrl = imageUrl ? null : meta?.video_poster ?? null;
  const TileIcon =
    event.kind === 'resource' && meta?.resource_type
      ? RESOURCE_TILE_ICON[meta.resource_type] ?? KIND_ICON.resource
      : KIND_ICON[event.kind];

  // Subtitle line under the title — kind-dependent. Thread and showcase
  // bodies store their whole text in `title`, so split headline vs body.
  let title = event.title;
  let subtitle: string | null = null;
  if (event.kind === 'thread' || event.kind === 'showcase') {
    const split = splitBody(event.title);
    title = split.title;
    subtitle =
      split.subtitle ??
      (event.kind === 'showcase' && meta?.description ? firstLine(meta.description, 80) : null);
  } else if (event.kind === 'event') {
    // The chat card is often the first place a member meets an event, so the
    // time it shows names the zone it was read in (web event-display parity).
    subtitle = meta?.event_date
      ? `${fmtEventSchedule(meta.event_date)} (${viewerZoneLabel(meta.event_date)})`
      : null;
  } else if (event.kind === 'resource') {
    subtitle = meta?.url ? prettyUrl(meta.url) : null;
  }

  const rsvpCount = event.kind === 'event' ? Math.max(0, meta?.rsvp_count ?? 0) : null;
  const goingLabel =
    rsvpCount !== null
      ? rsvpCount > 0
        ? `+${rsvpCount} going`
        : 'Be the first to go'
      : null;

  const reactions = event.reactions ?? [];
  // How much discussion the card has on its own detail page.
  const commentCount = Math.max(0, meta?.comment_count ?? 0);
  const eyebrowLabel =
    event.kind === 'resource' && meta?.resource_type
      ? RESOURCE_TYPE_LABELS[meta.resource_type] ?? theme.label
      : theme.label;

  const ownText = colors.chatOwnBubbleForeground;
  const textColor = isOwn ? ownText : colors.foreground;
  const mutedColor = isOwn ? ownText : colors.foregroundMuted;
  const mutedOpacity = isOwn ? 0.8 : 1;
  const bubbleMaxWidth = Math.min(screenWidth * 0.78, 420);

  // Own bubble: translucent media card on the blue; other: the raised surface.
  const cardBg = isOwn ? 'rgba(0, 0, 0, 0.20)' : colors.isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.03)';
  const cardBorder = isOwn ? 'rgba(255, 255, 255, 0.15)' : colors.isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';
  const cardPressedBg = isOwn ? 'rgba(0, 0, 0, 0.30)' : colors.isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)';

  return (
    <View style={[styles.row, !isOwn && styles.rowWithAvatar]}>
      {/* Avatar column — own notifications skip it, matching message bubbles */}
      {!isOwn && (
        <View style={styles.avatarCol}>
          <Avatar
            name={senderName}
            avatarUrl={event.users?.avatar_url ?? null}
            colors={colors}
            size={28}
          />
        </View>
      )}

      <View style={[styles.contentCol, { maxWidth: bubbleMaxWidth }]}>
        <View style={styles.bubbleWrap}>
          <View
            style={[
              styles.bubble,
              { backgroundColor: isOwn ? colors.chatOwnBubble : colors.surfaceRaised, shadowColor: '#000' },
              isOwn ? styles.bubbleOwn : styles.bubbleOther,
            ]}
          >
            <MessageBubbleTail
              side={isOwn ? 'right' : 'left'}
              color={isOwn ? colors.chatOwnBubble : colors.surfaceRaised}
            />

            {/* Header line — "You created a showcase" */}
            <Text style={[styles.header, { color: mutedColor }]}>
              {isOwn ? (
                <Text style={styles.headerName}>{name}</Text>
              ) : (
                <Text style={[styles.headerName, { color: userNameColor(event.user_id, colors) }]}>
                  {name}
                </Text>
              )}
              {` created ${withArticle(theme.label.toLowerCase())}`}
            </Text>

            {/* Card — opens the item on its own community tab */}
            <Pressable
              onPress={() => onOpen(event)}
              accessibilityRole="button"
              accessibilityLabel={`${name} created ${withArticle(theme.label.toLowerCase())}: ${event.title || theme.label}`}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: pressed ? cardPressedBg : cardBg,
                  borderColor: cardBorder,
                },
              ]}
            >
              {/* Thumbnail — image, video poster, or the shared solid-ink
                  icon tile, stretched to the card's full height (min 64px). */}
              <View style={styles.thumb}>
                {imageUrl ? (
                  <Image source={{ uri: imageUrl }} style={styles.thumbImage} resizeMode="cover" />
                ) : posterUrl ? (
                  <>
                    <Image source={{ uri: posterUrl }} style={styles.thumbImage} resizeMode="cover" />
                    <View style={styles.playOverlay}>
                      <View style={styles.playCircle}>
                        <ContentIcon name="video" size={12} color="#FFFFFF" />
                      </View>
                    </View>
                  </>
                ) : (
                  <View style={[styles.tile, { backgroundColor: colors.foreground }]}>
                    <ContentIcon name={TileIcon} size={24} color={colors.background} />
                  </View>
                )}
              </View>

              {/* Text column */}
              <View style={styles.textCol}>
                <View style={styles.eyebrowRow}>
                  <ContentIcon name={KIND_ICON[event.kind]} size={12} color={isOwn ? ownText : theme.accent} />
                  <Text style={[styles.eyebrow, { color: isOwn ? ownText : theme.accent }]}>
                    {eyebrowLabel}
                  </Text>
                </View>
                <Text numberOfLines={1} style={[styles.title, { color: textColor }]}>
                  {title || theme.label}
                </Text>
                {subtitle && (
                  <Text
                    numberOfLines={2}
                    style={[styles.subtitle, { color: mutedColor, opacity: mutedOpacity }]}
                  >
                    {subtitle}
                  </Text>
                )}
                {goingLabel && (
                  <View style={styles.goingRow}>
                    <ContentIcon name="users" size={10} color={mutedColor} />
                    <Text style={[styles.goingText, { color: mutedColor, opacity: mutedOpacity }]}>
                      {goingLabel}
                    </Text>
                  </View>
                )}
              </View>

              {/* Chevron affordance */}
              <View style={styles.chevronCol}>
                <ContentIcon
                  name="chevron-right"
                  size={14}
                  color={isOwn ? 'rgba(255, 255, 255, 0.6)' : colors.foregroundMuted}
                />
              </View>
            </Pressable>

            {/* Bottom row: the discussion sits bottom-LEFT of the bubble, the
                timestamp bottom-right, exactly like a message bubble's footer. */}
            <View style={styles.footer}>
              {commentCount > 0 && (
                <View style={styles.commentRow}>
                  <ContentIcon name="message-circle" size={10} color={mutedColor} />
                  <Text style={[styles.commentText, { color: mutedColor, opacity: mutedOpacity }]}>
                    {commentCount}
                  </Text>
                </View>
              )}
              <Text style={[styles.time, { color: mutedColor, opacity: isOwn ? 0.7 : 1 }]}>
                {fmtTime(event.created_at)}
              </Text>
            </View>

            {/* Reaction pills overlap the bubble's bottom edge, like messages */}
            <ContentReactionPills
              reactions={reactions}
              currentUserId={currentUserId}
              onPress={(emoji) => onReaction(event, emoji)}
              colors={colors}
            />
          </View>
        </View>

        {/* Reserve room for the pills that hang below the bubble */}
        {reactions.length > 0 && <View style={styles.reactionSpacer} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    gap: 8,
    marginTop: 12,
  },
  rowWithAvatar: { justifyContent: 'flex-start' },
  avatarCol: { width: 28, flexShrink: 0 },
  contentCol: { flexShrink: 1, minWidth: 0 },
  bubbleWrap: { position: 'relative', minWidth: 0 },

  bubble: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  bubbleOwn: { borderTopRightRadius: 0 },
  bubbleOther: { borderTopLeftRadius: 0 },

  header: { fontSize: 11, lineHeight: 15, marginBottom: 6 },
  headerName: { fontFamily: 'Geist_600SemiBold' },

  card: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  thumb: { width: 64, minHeight: 64, flexShrink: 0, overflow: 'hidden' },
  thumbImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tile: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  textCol: { flex: 1, minWidth: 0, paddingVertical: 6, paddingRight: 4 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eyebrow: {
    fontSize: 10,
    fontFamily: 'Geist_700Bold',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 14,
    lineHeight: 18,
    fontFamily: 'Geist_600SemiBold',
    marginTop: 2,
  },
  subtitle: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  goingRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  goingText: { fontSize: 10, fontFamily: 'Geist_400Regular' },
  chevronCol: { justifyContent: 'center', paddingRight: 10 },

  footer: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  commentRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  commentText: { fontSize: 10, fontFamily: 'Geist_400Regular' },
  time: { marginLeft: 'auto', fontSize: 10, fontFamily: 'Geist_400Regular' },

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
