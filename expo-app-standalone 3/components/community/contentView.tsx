import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  KeyboardAvoidingView as RNKeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  KeyboardAvoidingView as KeyboardControllerAvoidingView,
  useKeyboardState,
} from 'react-native-keyboard-controller';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { hapticSelection, hapticToggle } from '@/lib/haptics';
import { BooleanIntentCoalescer } from '@/lib/booleanIntentCoalescer';
import {
  CommunityContent,
  CommunityEvent,
  CommunityResource,
  CommunityShowcase,
  CommunityThread,
  ContentAction,
  ContentKind,
  collapsedBodyLines,
  contentAuthor,
  contentLabel,
  contentSecondaryLabel,
  formatRelativeDate,
  getLinkPreviewImage,
  setContentAction,
  threadBody,
  voteOnThreadPoll,
} from '@/lib/communityContent';
import { normalizePollCounts, type PollViewState } from '@/lib/communityPoll';
import { COMMENT_MAX_LENGTH, type CommunityComment } from '@/lib/comments';
import { ImageViewer, type LightboxImage } from '@/components/chat/ImageViewer';
import {
  CommentComposer,
  CommentSection,
  replyMention,
  type CommentSectionHandle,
} from './CommentSection';
import { ThreadPollView } from './ThreadPoll';
import { resolveProfilePictureUri } from '@/lib/profilePicture';
import { formatEventDate } from '@/lib/eventDate';
import { PersonAvatar } from '@/components/PersonAvatar';
import { HeartIcon } from './HeartIcon';

/**
 * The detail page is a full-screen `Modal`, where iOS's own keyboard avoiding
 * view is the dependable option; Android uses the keyboard-controller build
 * that the chat screens already rely on.
 */
const KeyboardAvoider: React.ComponentType<
  React.ComponentProps<typeof RNKeyboardAvoidingView>
> =
  Platform.OS === 'ios'
    ? RNKeyboardAvoidingView
    : (KeyboardControllerAvoidingView as React.ComponentType<
        React.ComponentProps<typeof RNKeyboardAvoidingView>
      >);

/**
 * The community card, the card detail, and the optimistic interaction state
 * behind them — shared by the community tabs and the home feed so a thread card
 * behaves and looks identical in both places.
 */

// ---------------------------------------------------------------------------
// Action definitions
// ---------------------------------------------------------------------------

export interface ActionDefinition {
  action: ContentAction;
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  /** Item property holding the confirmed boolean state. */
  field: string;
  /** Item property holding the confirmed count (omitted for plain saves). */
  countField?: string;
  /** Frames the count as a sentence ("3 going") instead of a bare number. */
  countSuffix?: string;
  /**
   * Tint when active. Only the heart uses the web `--like` pink; everything
   * else lights up in the accent colour, as it does on the web.
   */
  activeColor?: 'like' | 'accent';
}

/**
 * Every interaction a card can render, keyed by action. This table is the only
 * place the four API shapes are reconciled.
 */
const LIKE: ActionDefinition = { action: 'like', icon: 'heart', label: 'Like', field: 'user_liked', countField: 'like_count', activeColor: 'like' };
const SAVE: ActionDefinition = { action: 'save', icon: 'bookmark', label: 'Save', field: 'user_saved', activeColor: 'accent' };
const RSVP: ActionDefinition = { action: 'rsvp', icon: 'check-circle', label: 'Going', field: 'user_rsvped', countField: 'rsvp_count', countSuffix: 'going', activeColor: 'accent' };
/** The resource heart is the API's `save`, exactly as on the web. */
const RESOURCE_LIKE: ActionDefinition = { action: 'save', icon: 'heart', label: 'Like', field: 'user_saved', countField: 'save_count', activeColor: 'like' };
/** The resource menu's "Save"/"Unsave" rows are the API's bookmark. */
const BOOKMARK: ActionDefinition = { action: 'bookmark', icon: 'bookmark', label: 'Save', field: 'user_bookmarked', activeColor: 'accent' };

/**
 * What the card footer shows, per kind — the web cards keep the footer to the
 * heart and the comment count and move everything else into the ··· menu.
 * (Events additionally keep their RSVP there: the web shows it as its own wide
 * call-to-action, which the mobile footer stands in for.)
 */
export const FOOTER_ACTIONS_BY_KIND: Record<ContentKind, ActionDefinition[]> = {
  threads: [LIKE],
  showcase: [LIKE],
  events: [LIKE, RSVP],
  resources: [RESOURCE_LIKE],
};

/** Instagram's window: a second tap inside this counts as a double tap. */
const DOUBLE_TAP_MS = 300;

/** The save-shaped row the ··· menu offers, per kind (null when there is none). */
const MENU_ACTION_BY_KIND: Record<ContentKind, ActionDefinition | null> = {
  threads: SAVE,
  showcase: SAVE,
  events: SAVE,
  resources: BOOKMARK,
};

export function actionDefinition(kind: ContentKind, action: ContentAction): ActionDefinition | undefined {
  const all = [...FOOTER_ACTIONS_BY_KIND[kind], MENU_ACTION_BY_KIND[kind]].filter(Boolean) as ActionDefinition[];
  return all.find((entry) => entry.action === action);
}

function fieldOf(item: CommunityContent, field: string): unknown {
  return (item as unknown as Record<string, unknown>)[field];
}

// ---------------------------------------------------------------------------
// Optimistic interaction state
// ---------------------------------------------------------------------------

interface ActionOverride { value: boolean; count?: number }

export interface ContentActionsApi {
  action: (item: CommunityContent, kind: ContentKind, action: ContentAction) => void;
  isActive: (item: CommunityContent, kind: ContentKind, action: ContentAction) => boolean;
  countFor: (item: CommunityContent, kind: ContentKind, action: ContentAction) => number;
  commentCountFor: (item: CommunityContent) => number;
  setCommentCount: (itemId: string, total: number) => void;
  /** Drop every local override — used when the server sends fresh rows. */
  reset: () => void;
  /** Alert surfaced from a failed write, for screens that render their own toast. */
  lastError: string | null;
  clearError: () => void;
  /** The thread's poll with any local vote/undo override applied. */
  pollState: (item: CommunityContent) => PollViewState | null;
  /** Vote for one option (optimistic, reconciled with the server). */
  votePoll: (item: CommunityContent, optionIndex: number) => Promise<void>;
  /** Spend the viewer's one-time undo (optimistic). */
  undoPoll: (item: CommunityContent) => Promise<void>;
  /** Drop a thread's local poll state after an edit replaces the row. */
  resetPoll: (itemId: string) => void;
  /**
   * Fold a realtime poll event into an existing local vote. "mine" events
   * come from this member on another device, so their vote replaces ours;
   * another member's vote only refreshes the tallies.
   */
  applyPollUpdate: (
    itemId: string,
    update: { counts: number[]; userVote: number | null; undoUsed: boolean; mine: boolean },
  ) => void;
}

function pollKey(itemId: string) {
  return `${itemId}:poll`;
}

/** The poll state carried by the server row, before any local override. */
function serverPollState(thread: CommunityThread): PollViewState | null {
  const poll = thread.poll;
  if (!poll || !Array.isArray(poll.options) || poll.options.length < 2) return null;
  return {
    counts: normalizePollCounts(poll, thread.poll_vote_counts),
    userVote: typeof thread.poll_user_vote === 'number' ? thread.poll_user_vote : null,
    undoUsed: thread.poll_undo_used === true,
  };
}

/**
 * Owns the optimistic state of every card interaction on a screen.
 *
 * Each interaction is coalesced by `BooleanIntentCoalescer`, so rapid taps
 * collapse into one idempotent desired-state write and a stale response can
 * never overwrite a newer intent. The community is read from the item, which
 * lets the home feed mix posts from many communities in one list.
 */
export function useContentActions(): ContentActionsApi {
  const [overrides, setOverrides] = useState<Record<string, ActionOverride>>({});
  const [pollOverrides, setPollOverrides] = useState<Record<string, PollViewState>>({});
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [lastError, setLastError] = useState<string | null>(null);
  const coalescersRef = useRef(new Map<string, BooleanIntentCoalescer>());

  useEffect(() => {
    const coalescers = coalescersRef.current;
    return () => {
      coalescers.forEach((coalescer) => coalescer.dispose());
      coalescers.clear();
    };
  }, []);

  const action = useCallback(
    (item: CommunityContent, kind: ContentKind, actionName: ContentAction) => {
      const definition = actionDefinition(kind, actionName);
      if (!definition || !item.community_id) return;
      const overrideKey = `${kind}:${item.id}:${actionName}`;
      const initial = Boolean(fieldOf(item, definition.field));
      const initialCount = definition.countField
        ? Number(fieldOf(item, definition.countField) ?? 0)
        : 0;

      let coalescer = coalescersRef.current.get(overrideKey);
      if (!coalescer) {
        coalescer = new BooleanIntentCoalescer({
          initialValue: initial,
          onOptimisticChange: (desired) => {
            setOverrides((current) => {
              const previous = current[overrideKey]?.value ?? initial;
              const previousCount = current[overrideKey]?.count ?? initialCount;
              const count = definition.countField
                ? Math.max(0, previousCount + (desired === previous ? 0 : desired ? 1 : -1))
                : undefined;
              return { ...current, [overrideKey]: { value: desired, count } };
            });
          },
          persist: async (desired) => {
            const result = await setContentAction(
              item.community_id,
              kind,
              item.id,
              actionName,
              desired,
            );
            if (typeof result.count === 'number') {
              setOverrides((current) => ({
                ...current,
                [overrideKey]: { value: result.value, count: result.count },
              }));
            }
            return result.value;
          },
          onError: (error) => {
            setLastError(error instanceof Error ? error.message : 'Please try again.');
          },
        });
        coalescersRef.current.set(overrideKey, coalescer);
      }

      coalescer.toggle();
    },
    [],
  );

  const isActive = useCallback(
    (item: CommunityContent, kind: ContentKind, actionName: ContentAction): boolean => {
      const override = overrides[`${kind}:${item.id}:${actionName}`];
      if (override) return override.value;
      const definition = actionDefinition(kind, actionName);
      return definition ? Boolean(fieldOf(item, definition.field)) : false;
    },
    [overrides],
  );

  const countFor = useCallback(
    (item: CommunityContent, kind: ContentKind, actionName: ContentAction): number => {
      const definition = actionDefinition(kind, actionName);
      if (!definition?.countField) return 0;
      const override = overrides[`${kind}:${item.id}:${actionName}`];
      if (override && typeof override.count === 'number') return override.count;
      return Number(fieldOf(item, definition.countField) ?? 0);
    },
    [overrides],
  );

  const commentCountFor = useCallback(
    (item: CommunityContent): number => {
      const local = commentCounts[item.id];
      if (typeof local === 'number') return local;
      return Number((item as { comment_count?: number }).comment_count ?? 0);
    },
    [commentCounts],
  );

  const setCommentCount = useCallback(
    (itemId: string, total: number) =>
      setCommentCounts((current) => ({ ...current, [itemId]: total })),
    [],
  );

  /**
   * The poll as the card/detail should render it: a local optimistic vote (or
   * undo) wins until the server row or a reset replaces it.
   */
  const pollState = useCallback(
    (item: CommunityContent): PollViewState | null => {
      const base = serverPollState(item as CommunityThread);
      if (!base) return null;
      return pollOverrides[pollKey(item.id)] ?? base;
    },
    [pollOverrides],
  );

  const votePoll = useCallback(
    async (item: CommunityContent, optionIndex: number) => {
      const thread = item as CommunityThread;
      const poll = thread.poll;
      if (!poll || !item.community_id) return;
      const key = pollKey(item.id);
      const current = pollOverrides[key] ?? serverPollState(thread);
      if (!current || current.userVote !== null) return;
      if (
        !Number.isInteger(optionIndex) ||
        optionIndex < 0 ||
        optionIndex >= poll.options.length
      ) {
        return;
      }

      const previous = pollOverrides[key] ?? null;
      setPollOverrides((state) => ({
        ...state,
        [key]: {
          counts: current.counts.map((count, index) =>
            index === optionIndex ? count + 1 : count,
          ),
          userVote: optionIndex,
          undoUsed: current.undoUsed,
        },
      }));

      try {
        const result = await voteOnThreadPoll(item.community_id, item.id, optionIndex);
        setPollOverrides((state) => ({
          ...state,
          [key]: {
            counts: result.counts,
            userVote: result.userVote,
            undoUsed: result.undoUsed,
          },
        }));
      } catch (error) {
        // Back to the pre-vote row; the poll renders its own error.
        setPollOverrides((state) => {
          const next = { ...state };
          if (previous) next[key] = previous;
          else delete next[key];
          return next;
        });
        throw error;
      }
    },
    [pollOverrides],
  );

  const undoPoll = useCallback(
    async (item: CommunityContent) => {
      const thread = item as CommunityThread;
      const poll = thread.poll;
      if (!poll || !item.community_id) return;
      const key = pollKey(item.id);
      const current = pollOverrides[key] ?? serverPollState(thread);
      if (!current || current.userVote === null || current.undoUsed) return;

      const previous = pollOverrides[key] ?? null;
      const votedFor = current.userVote;
      setPollOverrides((state) => ({
        ...state,
        [key]: {
          counts: current.counts.map((count, index) =>
            index === votedFor ? Math.max(0, count - 1) : count,
          ),
          userVote: null,
          undoUsed: true,
        },
      }));

      try {
        const result = await voteOnThreadPoll(item.community_id, item.id, null);
        setPollOverrides((state) => ({
          ...state,
          [key]: {
            counts: result.counts,
            userVote: result.userVote,
            undoUsed: result.undoUsed,
          },
        }));
      } catch (error) {
        setPollOverrides((state) => {
          const next = { ...state };
          if (previous) next[key] = previous;
          else delete next[key];
          return next;
        });
        throw error;
      }
    },
    [pollOverrides],
  );

  const applyPollUpdate = useCallback(
    (
      itemId: string,
      update: { counts: number[]; userVote: number | null; undoUsed: boolean; mine: boolean },
    ) => {
      const key = pollKey(itemId);
      setPollOverrides((state) => {
        const current = state[key];
        // No local vote to preserve — the patched row carries the new tallies.
        if (!current) return state;
        return {
          ...state,
          [key]: {
            counts: update.counts,
            userVote: update.mine ? update.userVote : current.userVote,
            undoUsed: update.mine ? update.undoUsed : current.undoUsed,
          },
        };
      });
    },
    [],
  );

  const resetPoll = useCallback((itemId: string) => {
    setPollOverrides((state) => {
      const key = pollKey(itemId);
      if (!(key in state)) return state;
      const next = { ...state };
      delete next[key];
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setOverrides({});
    setPollOverrides({});
    setCommentCounts({});
  }, []);

  return {
    action,
    isActive,
    countFor,
    commentCountFor,
    setCommentCount,
    reset,
    lastError,
    clearError: useCallback(() => setLastError(null), []),
    pollState,
    votePoll,
    undoPoll,
    resetPoll,
    applyPollUpdate,
  };
}

// ---------------------------------------------------------------------------
// Resource link preview
// ---------------------------------------------------------------------------

const previewCache = new Map<string, string | null>();

export function useResourcePreview(url?: string) {
  const [image, setImage] = useState<string | null>(
    () => (url && previewCache.has(url) ? previewCache.get(url) ?? null : null),
  );
  useEffect(() => {
    if (!url || previewCache.has(url)) return;
    let active = true;
    getLinkPreviewImage(url)
      .then((result) => { previewCache.set(url, result); if (active) setImage(result); })
      .catch(() => previewCache.set(url, null));
    return () => { active = false; };
  }, [url]);
  return image;
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export interface ContentCardProps {
  item: CommunityContent;
  kind: ContentKind;
  currentUserId: string;
  actions: ContentActionsApi;
  /** Feed cards show which community the post came from. */
  communityName?: string | null;
  communityImage?: string | null;
  /** The comment count — the only route into the post's own page. */
  onComments: (item: CommunityContent) => void;
  onEdit?: (item: CommunityContent) => void;
  /** Rejects when the server refuses, so the confirm can stay open. */
  onDelete?: (item: CommunityContent) => Promise<void> | void;
}

export function ContentCard({
  item,
  kind,
  currentUserId,
  actions,
  communityName,
  communityImage,
  onComments,
  onEdit,
  onDelete,
}: ContentCardProps) {
  const colors = useColors();
  const thread = kind === 'threads' ? item as CommunityThread : null;
  const event = kind === 'events' ? item as CommunityEvent : null;
  const resource = kind === 'resources' ? item as CommunityResource : null;
  const showcase = kind === 'showcase' ? item as CommunityShowcase : null;
  const author = contentAuthor(item);
  const images = (thread?.attachments ?? showcase?.attachments ?? [])
    .filter((attachment) => attachment.type.startsWith('image/'));
  const previewImage = useResourcePreview(resource?.url);
  const coverImage = event?.cover_image_url ?? showcase?.image_url ?? (resource ? previewImage : null);
  // Every event card says when — the web card's first row — and a bad
  // timestamp costs the row rather than printing "Invalid Date".
  const eventDateLabel = event ? formatEventDate(event.event_date) : null;
  const isOwner = item.user_id === currentUserId;

  // The body text each kind puts on its card, mirroring the web cards: a thread
  // shows its body (the whole post lives in `title` on the web) collapsed behind
  // "Read more", an event shows a 2-line title plus a collapsible description, a
  // resource clamps its description to 3 lines, and a showcase title is never
  // clamped.
  const primaryBody = resource
    ? resource.description || resource.title
    : kind === 'threads' && thread
      ? threadBody(thread)
      : item.title;
  const secondaryBody = kind === 'events' ? item.description : null;
  const primaryLines =
    kind === 'threads' ? collapsedBodyLines(kind, item)
      : kind === 'events' ? 2
        : kind === 'resources' ? 3
          : undefined;
  const pollState = thread?.poll ? actions.pollState(item) : null;

  // A double tap on the card likes it — Instagram's gesture. The footer heart
  // is still the explicit control; this is the shortcut, and it only ever
  // likes (a second double tap leaves an already-liked post alone).
  const likeDefinition = FOOTER_ACTIONS_BY_KIND[kind].find((entry) => entry.activeColor === 'like');
  const liked = likeDefinition ? actions.isActive(item, kind, likeDefinition.action) : false;
  const burst = useRef(new Animated.Value(0)).current;
  const lastTapAt = useRef(0);
  const reduceMotion = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => { reduceMotion.current = enabled; })
      .catch(() => { /* assume motion is fine */ });
  }, []);

  const likeFromDoubleTap = () => {
    if (!likeDefinition) return;
    if (!liked) {
      hapticToggle(true);
      actions.action(item, kind, likeDefinition.action);
    }
    if (reduceMotion.current) return;
    burst.stopAnimation();
    burst.setValue(0);
    Animated.timing(burst, {
      toValue: 1,
      duration: 620,
      easing: Easing.out(Easing.quad),
      // Opacity and transform only — the burst never touches layout.
      useNativeDriver: true,
    }).start();
  };

  const handleCardPress = () => {
    const now = Date.now();
    if (now - lastTapAt.current > DOUBLE_TAP_MS) {
      lastTapAt.current = now;
      return;
    }
    lastTapAt.current = 0;
    likeFromDoubleTap();
  };

  return (
    <Pressable
      onPress={handleCardPress}
      // The card is a gesture surface, not a single control: keep the inner
      // buttons and links as the accessible units.
      accessible={false}
      style={[styles.card, { backgroundColor: colors.backgroundSubtle, borderColor: colors.border }]}
    >
      {coverImage ? <Image source={{ uri: coverImage }} style={styles.cover} /> : null}

      <View style={styles.cardBody}>
        {/* Author meta — name and relative date on one line, the category as
            the muted second line, exactly like the web `PostAuthorMeta`. */}
        <View style={styles.authorRow}>
          <PersonAvatar name={author?.name} url={author?.avatar_url} size={40} />
          <View style={styles.authorCopy}>
            <View style={styles.authorLine}>
              <Text style={[styles.author, { color: colors.foreground }]} numberOfLines={1}>
                {author?.name ?? 'Community member'}
              </Text>
              <Text style={[styles.meta, { color: colors.foregroundSubtle }]} numberOfLines={1}>
                {formatRelativeDate(item.created_at)}
              </Text>
            </View>
            <Text style={[styles.secondaryLabel, { color: colors.foregroundSubtle }]} numberOfLines={1}>
              {contentSecondaryLabel(kind, item)}
            </Text>
          </View>
          <ContentOptionsMenu
            item={item}
            kind={kind}
            actions={actions}
            isOwner={isOwner}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </View>

        <CollapsibleBody
          text={primaryBody}
          textStyle={styles.cardTitle}
          collapsedLines={primaryLines}
          expandable={kind === 'threads'}
        />
        {secondaryBody ? (
          <CollapsibleBody text={secondaryBody} textStyle={styles.description} collapsedLines={2} />
        ) : null}
        {thread?.poll && pollState ? (
          <ThreadPollView
            poll={thread.poll}
            state={pollState}
            hideQuestion={thread.poll.question.trim() === thread.title.trim()}
            onVote={(optionIndex) => actions.votePoll(item, optionIndex)}
            onUndo={() => actions.undoPoll(item)}
          />
        ) : null}
        {images.length ? (
          <MediaCarousel
            images={images}
            owner={{
              name: author?.name ?? null,
              avatarUrl: author?.avatar_url ?? null,
              createdAt: item.created_at,
            }}
            onDoubleTap={likeFromDoubleTap}
          />
        ) : null}

        {event ? (
          <View style={styles.eventMetaStack}>
            {eventDateLabel ? <DetailRow icon="calendar" text={eventDateLabel} /> : null}
            <View style={styles.eventMeta}>
              <Feather name={event.is_online ? 'video' : 'map-pin'} size={15} color={colors.accent} />
              <Text style={[styles.eventMetaText, { color: colors.foregroundMuted }]}>
                {event.is_online ? 'Online event' : event.location || 'Location to be announced'}
              </Text>
            </View>
          </View>
        ) : null}

        <ContentActionRow
          item={item}
          kind={kind}
          actions={actions}
          commentCount={actions.commentCountFor(item)}
          onComments={onComments}
          communityName={communityName}
          communityImage={communityImage}
        />
      </View>

      {/* The double-tap burst: a filled heart that pops in over the card and
          fades, never intercepting a touch. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.likeBurst,
          {
            opacity: burst.interpolate({
              inputRange: [0, 0.15, 0.7, 1],
              outputRange: [0, 1, 1, 0],
              extrapolate: 'clamp',
            }),
            transform: [
              {
                scale: burst.interpolate({
                  inputRange: [0, 0.35, 1],
                  outputRange: [0.55, 1.08, 1],
                  extrapolate: 'clamp',
                }),
              },
            ],
          },
        ]}
      >
        <HeartIcon size={96} active />
      </Animated.View>
    </Pressable>
  );
}

export function ContentActionRow({
  item,
  kind,
  actions,
  commentCount,
  onComments,
  communityName,
  communityImage,
}: {
  item: CommunityContent;
  kind: ContentKind;
  actions: ContentActionsApi;
  commentCount: number;
  onComments: (item: CommunityContent) => void;
  /** Feed rows name the community the post came from, right-aligned like the web. */
  communityName?: string | null;
  communityImage?: string | null;
}) {
  const colors = useColors();
  const communityAvatar = resolveProfilePictureUri(communityImage);
  return (
    <View style={styles.actions}>
      {FOOTER_ACTIONS_BY_KIND[kind].map((definition) => {
        const active = actions.isActive(item, kind, definition.action);
        const count = actions.countFor(item, kind, definition.action);
        // Count-less actions toggle their verb instead of showing a number,
        // exactly like the web "Save" / "Unsave" buttons.
        const label = definition.countSuffix
          ? `${count} ${definition.countSuffix}`
          : definition.countField
            ? String(count)
            : active
              ? 'Unsave'
              : definition.label;
        return (
          <Action
            key={definition.action}
            icon={definition.icon}
            label={label}
            active={active}
            activeColor={definition.activeColor}
            accessibilityLabel={`${active ? 'Remove' : 'Add'} ${definition.label}`}
            onPress={() => {
              // Every footer action is a desired-state flip: the tick follows the
              // direction the tap is about to take.
              hapticToggle(!active);
              actions.action(item, kind, definition.action);
            }}
          />
        );
      })}
      <Action
        icon="message-circle"
        label={String(commentCount)}
        compact
        accessibilityLabel="Comments"
        onPress={() => {
          hapticSelection();
          onComments(item);
        }}
      />

      {/* Community attribution — the web keeps the engagement cluster on the
          left and puts "posted in <community>" at the bottom-right. */}
      {communityName ? (
        <View style={styles.communityLabel}>
          <Text style={[styles.communityLabelText, { color: colors.foregroundSubtle }]} numberOfLines={1}>
            posted in
          </Text>
          {communityAvatar ? (
            <Image source={{ uri: communityAvatar }} style={styles.communityLabelAvatar} />
          ) : (
            <View style={[styles.communityLabelAvatar, { backgroundColor: colors.surfaceRaised }]} />
          )}
          <Text
            style={[styles.communityLabelName, { color: colors.foregroundMuted }]}
            numberOfLines={1}
          >
            {communityName}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Detail
// ---------------------------------------------------------------------------

export function ContentDetail({
  item,
  kind,
  currentUserId,
  actions,
  communityName,
  visible,
  loading = false,
  onClose,
  onEdit,
  onDelete,
}: {
  item: CommunityContent | null;
  kind: ContentKind;
  currentUserId: string;
  actions: ContentActionsApi;
  communityName?: string | null;
  visible: boolean;
  /** The row is still being fetched — show a spinner instead of nothing. */
  loading?: boolean;
  onClose: () => void;
  onEdit?: (item: CommunityContent) => void;
  onDelete?: (item: CommunityContent) => Promise<void> | void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const resource = kind === 'resources' ? (item as CommunityResource | null) : null;
  const previewImage = useResourcePreview(resource?.url);
  // The page always opens at its own start — the reader asked for this post,
  // not for its comments. Tapping the footer's comment count still jumps to
  // the discussion, so its offset is all this needs to know.
  const scrollRef = useRef<ScrollView>(null);
  const [commentsY, setCommentsY] = useState(0);
  const sectionRef = useRef<CommentSectionHandle>(null);
  // Who the pinned composer is aimed at — null means a top-level comment.
  const [replyTarget, setReplyTarget] = useState<CommunityComment | null>(null);
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  // Some screens keep the sheet mounted between posts, so a previously read
  // page must not carry its scroll offset into the next open.
  useEffect(() => {
    if (visible) {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      setReplyTarget(null);
    }
  }, [visible, item?.id]);

  // A chat card can open the page before its tab's list has loaded, so the
  // sheet has to answer the tap itself rather than staying invisible until the
  // row arrives.
  if (!item) {
    if (!visible || !loading) return null;
    return (
      <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
        <View style={[styles.detailRoot, styles.detailLoading, { backgroundColor: colors.background }]}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </Modal>
    );
  }

  const thread = kind === 'threads' ? item as CommunityThread : null;
  const event = kind === 'events' ? item as CommunityEvent : null;
  const showcase = kind === 'showcase' ? item as CommunityShowcase : null;
  const author = contentAuthor(item);
  const images = (thread?.attachments ?? showcase?.attachments ?? [])
    .filter((attachment) => attachment.type.startsWith('image/'));
  const files = (thread?.attachments ?? []).filter((attachment) => !attachment.type.startsWith('image/'));
  const coverImage = event?.cover_image_url ?? showcase?.image_url ?? (resource ? previewImage : null);
  const isOwner = item.user_id === currentUserId;
  const pollState = thread?.poll ? actions.pollState(item) : null;
  // Events have no reply switch — their comment threads are always open.
  const allowReplies =
    kind === 'events'
      ? true
      : (item as { allow_replies?: boolean }).allow_replies !== false;

  const scrollToComments = () => {
    scrollRef.current?.scrollTo({ y: Math.max(0, commentsY - 8), animated: true });
  };

  // A comment posted from the pinned composer joins the list the section
  // already owns, and a reply leaves reply mode.
  const handleCommentPosted = (comment: CommunityComment) => {
    sectionRef.current?.appendPosted(comment);
    setReplyTarget(null);
  };

  // The composer bar keeps its safe-area padding only while the keyboard is
  // down; with the keyboard up it hugs the keyboard's top edge.
  const composerBottomInset = keyboardVisible ? 8 : Math.max(insets.bottom, 8);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={[styles.detailRoot, { backgroundColor: colors.background }]}>
        <View style={[styles.detailHeader, { paddingTop: insets.top + 8, borderBottomColor: colors.borderSubtle }]}>
          <Pressable onPress={onClose} style={styles.headerButton} accessibilityLabel="Back">
            <Feather name="arrow-left" size={25} color={colors.foreground} />
          </Pressable>
          <Text style={[styles.detailHeaderTitle, { color: colors.foreground }]} numberOfLines={1}>
            {communityName ?? contentLabel(kind)}
          </Text>
          <ContentOptionsMenu
            item={item}
            kind={kind}
            actions={actions}
            isOwner={isOwner}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </View>

        <KeyboardAvoider
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={[styles.detailContent, { paddingBottom: 24 }]}
          keyboardShouldPersistTaps="handled"
        >
          {coverImage ? <Image source={{ uri: coverImage }} style={styles.detailCover} /> : null}

          <View style={styles.authorRow}>
            <PersonAvatar name={author?.name} url={author?.avatar_url} size={40} />
            <View style={styles.authorCopy}>
              <View style={styles.authorLine}>
                <Text style={[styles.author, { color: colors.foreground }]} numberOfLines={1}>
                  {author?.name ?? 'Community member'}
                </Text>
                <Text style={[styles.meta, { color: colors.foregroundSubtle }]} numberOfLines={1}>
                  {formatRelativeDate(item.created_at)}
                </Text>
              </View>
              <Text style={[styles.secondaryLabel, { color: colors.foregroundSubtle }]} numberOfLines={1}>
                {contentSecondaryLabel(kind, item)}
              </Text>
            </View>
          </View>

          {/* Threads carry the whole post in the body, exactly like the web
              card, so the detail uses the same compact type instead of the
              large title the other kinds still use. */}
          <Text
            style={[
              thread ? styles.detailThreadBody : styles.detailTitle,
              { color: colors.foreground },
            ]}
          >
            {thread ? threadBody(thread) : item.title}
          </Text>
          {!thread && item.description ? (
            <Text style={[styles.detailDescription, { color: colors.foregroundMuted }]}>
              {item.description}
            </Text>
          ) : null}
          {thread?.poll && pollState ? (
            <ThreadPollView
              poll={thread.poll}
              state={pollState}
              hideQuestion={thread.poll.question.trim() === thread.title.trim()}
              onVote={(optionIndex) => actions.votePoll(item, optionIndex)}
              onUndo={() => actions.undoPoll(item)}
            />
          ) : null}
          {images.length ? (
            <MediaCarousel
              images={images}
              owner={{
                name: author?.name ?? null,
                avatarUrl: author?.avatar_url ?? null,
                createdAt: item.created_at,
              }}
            />
          ) : null}

          {files.map((file) => (
            <Pressable
              key={file.url}
              onPress={() => Linking.openURL(file.url)}
              style={[styles.linkButton, { backgroundColor: colors.surfaceRaised }]}
            >
              <Feather name="paperclip" size={16} color={colors.accent} />
              <Text style={[styles.linkText, { color: colors.accent }]} numberOfLines={1}>{file.name}</Text>
            </Pressable>
          ))}

          {event ? (
            <View style={[styles.detailPanel, { backgroundColor: colors.surfaceRaised }]}>
              <DetailRow icon="calendar" text={new Date(event.event_date).toLocaleString()} />
              <DetailRow
                icon={event.is_online ? 'video' : 'map-pin'}
                text={event.is_online ? 'Online event' : event.location || 'Location to be announced'}
              />
              {event.meet_link ? (
                <Pressable
                  onPress={() => Linking.openURL(event.meet_link!)}
                  style={[styles.linkButton, { backgroundColor: colors.surface }]}
                >
                  <Feather name="video" size={16} color={colors.accent} />
                  <Text style={[styles.linkText, { color: colors.accent }]}>Open meeting link</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {resource ? (
            <Pressable
              onPress={() => Linking.openURL(resource.url)}
              style={[styles.primaryLink, { backgroundColor: colors.accent }]}
            >
              <Feather name="external-link" size={17} color={colors.accentForeground} />
              <Text style={[styles.primaryLinkText, { color: colors.accentForeground }]}>Open resource</Text>
            </Pressable>
          ) : null}

          <ContentActionRow
            item={item}
            kind={kind}
            actions={actions}
            commentCount={actions.commentCountFor(item)}
            onComments={scrollToComments}
          />

          <View onLayout={(event) => setCommentsY(event.nativeEvent.layout.y)}>
            <CommentSection
              ref={sectionRef}
              communityId={item.community_id}
              kind={kind}
              targetId={item.id}
              currentUserId={currentUserId}
              allowReplies={allowReplies}
              replyTarget={replyTarget}
              onReplyTargetChange={setReplyTarget}
              onCountChange={(total) => actions.setCommentCount(item.id, total)}
            />
          </View>
        </ScrollView>

        {allowReplies ? (
          <CommentComposer
            key={replyTarget?.id ?? 'root'}
            communityId={item.community_id}
            kind={kind}
            targetId={item.id}
            parentId={replyTarget ? replyTarget.parent_id ?? replyTarget.id : null}
            initialBody={replyTarget ? replyMention(replyTarget, currentUserId) : undefined}
            maxLength={COMMENT_MAX_LENGTH[kind]}
            placeholder="Add comment"
            submitLabel={replyTarget ? 'Reply' : 'Send'}
            autoFocus={Boolean(replyTarget)}
            replyToName={replyTarget ? replyTarget.users?.name ?? 'Member' : null}
            replyToBody={replyTarget?.body ?? null}
            onCancelReply={() => setReplyTarget(null)}
            onPosted={handleCommentPosted}
            bottomInset={composerBottomInset}
          />
        ) : null}
        </KeyboardAvoider>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/**
 * The ··· menu.
 *
 * Mirrors the web dropdown: Save/Unsave first (available to everyone — this is
 * where saving lives, it is deliberately not in the footer), then Edit and
 * Delete for the author.
 */
export function ContentOptionsMenu({
  item,
  kind,
  actions,
  isOwner,
  onEdit,
  onDelete,
}: {
  item: CommunityContent;
  kind: ContentKind;
  actions: ContentActionsApi;
  isOwner: boolean;
  onEdit?: (item: CommunityContent) => void;
  /** Rejects when the server refuses, so the confirm can stay open. */
  onDelete?: (item: CommunityContent) => Promise<void> | void;
}) {
  const colors = useColors();
  const [visible, setVisible] = useState(false);
  // Delete asks first, in-sheet — the same confirm vocabulary as the message
  // and chat-actions sheets, instead of the system alert.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const saveAction = MENU_ACTION_BY_KIND[kind];
  const saved = saveAction ? actions.isActive(item, kind, saveAction.action) : false;
  const noun = contentLabel(kind).toLowerCase();

  const close = () => {
    if (deleting) return;
    setVisible(false);
    setConfirmingDelete(false);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!onDelete || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(item);
      setDeleting(false);
      setVisible(false);
      setConfirmingDelete(false);
    } catch (e) {
      // Stay open with the reason, so the user can retry or back out.
      setDeleting(false);
      setDeleteError(e instanceof Error ? e.message : 'Could not delete. Please try again.');
    }
  };

  return (
    <>
      <Pressable
        onPress={(event) => {
          event.stopPropagation();
          hapticSelection();
          setVisible(true);
        }}
        style={styles.menuButton}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Post options"
      >
        <Feather name="more-vertical" size={21} color={colors.foregroundSubtle} />
      </Pressable>

      <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={close}>
        <Pressable style={styles.menuBackdrop} onPress={close} accessibilityLabel="Close post options">
          <View style={[styles.optionsSheet, { backgroundColor: colors.overlayElevated, shadowColor: '#000' }]}>
            {confirmingDelete ? (
              <View>
                <View style={[styles.confirmHeader, { borderBottomColor: colors.borderSubtle }]}>
                  <Text style={[styles.confirmTitle, { color: colors.foreground }]}>
                    Delete {noun}?
                  </Text>
                  <Text style={[styles.confirmBody, { color: colors.foregroundMuted }]}>
                    This cannot be undone.
                  </Text>
                  {deleteError ? (
                    <Text style={[styles.confirmError, { color: colors.destructive }]}>
                      {deleteError}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => {
                    hapticSelection();
                    void confirmDelete();
                  }}
                  disabled={deleting}
                  accessibilityRole="button"
                  accessibilityState={{ busy: deleting }}
                  style={({ pressed }) => [
                    styles.confirmAction,
                    {
                      backgroundColor: pressed ? colors.destructive + '1A' : 'transparent',
                      opacity: deleting ? 0.6 : 1,
                    },
                  ]}
                >
                  {deleting ? <ActivityIndicator size="small" color={colors.destructive} /> : null}
                  <Text style={[styles.confirmActionText, { color: colors.destructive }]}>
                    {deleting ? 'Deleting…' : `Delete ${noun}`}
                  </Text>
                </Pressable>
                <View style={[styles.optionDivider, { backgroundColor: colors.borderSubtle }]} />
                <Pressable
                  onPress={() => {
                    hapticSelection();
                    setConfirmingDelete(false);
                    setDeleteError(null);
                  }}
                  disabled={deleting}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.confirmAction,
                    { backgroundColor: pressed ? colors.subtle : 'transparent' },
                  ]}
                >
                  <Text style={[styles.confirmActionText, { color: colors.foregroundMuted }]}>
                    Cancel
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {!confirmingDelete && saveAction ? (
              <Pressable
                onPress={() => {
                  hapticToggle(!saved);
                  setVisible(false);
                  actions.action(item, kind, saveAction.action);
                }}
                style={styles.optionRow}
                accessibilityRole="button"
                accessibilityState={{ selected: saved }}
              >
                <Feather
                  name={saveAction.icon}
                  size={16}
                  color={saved ? colors.accent : colors.foregroundMuted}
                />
                <Text style={[styles.optionText, { color: saved ? colors.accent : colors.foreground }]}>
                  {saved ? 'Unsave' : 'Save'}
                </Text>
              </Pressable>
            ) : null}

            {!confirmingDelete && isOwner && onEdit && onDelete ? (
              <>
                <View style={[styles.optionDivider, { backgroundColor: colors.borderSubtle }]} />
                <Pressable
                  onPress={() => {
                    hapticSelection();
                    close();
                    onEdit(item);
                  }}
                  style={styles.optionRow}
                  accessibilityRole="button"
                >
                  <Feather name="edit-2" size={16} color={colors.foreground} />
                  <Text style={[styles.optionText, { color: colors.foreground }]}>Edit</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    hapticSelection();
                    setConfirmingDelete(true);
                  }}
                  style={styles.optionRow}
                  accessibilityRole="button"
                >
                  <Feather name="trash-2" size={16} color={colors.destructive} />
                  <Text style={[styles.optionText, { color: colors.destructive }]}>Delete</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

/**
 * Card body text, collapsed to `collapsedLines` behind a "Read more" — the
 * mobile equivalent of the web `TruncateMarkup` + inline Read more button.
 */
export function CollapsibleBody({
  text,
  textStyle,
  collapsedLines,
  expandable = true,
}: {
  text: string | null | undefined;
  textStyle: React.ComponentProps<typeof Text>['style'];
  /** Omit to render the text in full — no clamp and no "Read more". */
  collapsedLines?: number;
  /** False renders a plain clamp with no affordance (web resource cards). */
  expandable?: boolean;
}) {
  const colors = useColors();
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);

  if (!text) return null;

  return (
    <View>
      <Text
        style={[textStyle, { color: colors.foreground }]}
        numberOfLines={expanded || !collapsedLines ? undefined : collapsedLines}
        onTextLayout={(event) => {
          if (expanded || !collapsedLines) return;
          const lines = event.nativeEvent.lines.length;
          setTruncated(lines >= collapsedLines);
        }}
      >
        {text}
      </Text>
      {truncated && !expanded && expandable ? (
        <Pressable
          onPress={(event) => {
            event.stopPropagation();
            hapticSelection();
            setExpanded(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Read more"
          hitSlop={6}
        >
          <Text style={[styles.readMore, { color: colors.foregroundSubtle }]}>Read more</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * A thread's images, at the bottom of its body.
 *
 * One image keeps its natural aspect ratio; several become a swipeable
 * carousel with a counter, rather than a cropped tile grid. Tapping opens the
 * app's own lightbox — the same one the community chat uses — never the
 * system browser, so images stay inside the app.
 */
export function MediaCarousel({
  images,
  owner,
  /** Double tap on a photo: like the post instead of opening the viewer. */
  onDoubleTap,
}: {
  images: Array<{ url: string }>;
  /** The poster — the lightbox header's name, avatar and date, as in chat. */
  owner: { name: string | null; avatarUrl: string | null; createdAt: string };
  onDoubleTap?: () => void;
}) {
  const colors = useColors();
  const { width: screenWidth } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const stripRef = useRef<ScrollView>(null);
  const single = images.length === 1;
  // The web's thread media keeps every image at its natural aspect ratio,
  // capped at 480px tall and never cropped. A carousel takes its height from
  // the first image — the web's invisible sizing anchor — so the card adopts
  // the same shape a single image would and the slides letterbox inside it,
  // just as `object-contain` does there.
  const anchorRatio = useImageAspectRatio(images[0]?.url);
  // One page per image. Before the first layout pass the container's width is
  // unknown, so start from the screen width less the usual card gutter.
  const pageWidth = containerWidth || Math.max(1, screenWidth - 40);
  const pageHeight = anchorRatio
    ? Math.min(480, pageWidth / anchorRatio)
    : Math.round((pageWidth * 9) / 16);

  // Opening a photo waits out the double-tap window, so a second tap can like
  // the post instead — the gesture has to work over the photo, not just the
  // margins around it.
  const lastTapAt = useRef(0);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (openTimer.current) clearTimeout(openTimer.current);
    },
    [],
  );

  /** Dots jump between slides, like the web control's buttons. */
  const scrollToPage = (page: number) => {
    setIndex(page);
    stripRef.current?.scrollTo({ x: page * pageWidth, animated: true });
  };

  const handleImagePress = (imageIndex: number) => {
    const now = Date.now();
    if (now - lastTapAt.current <= DOUBLE_TAP_MS) {
      lastTapAt.current = 0;
      if (openTimer.current) {
        clearTimeout(openTimer.current);
        openTimer.current = null;
      }
      onDoubleTap?.();
      return;
    }
    lastTapAt.current = now;
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      openTimer.current = null;
      setViewerIndex(imageIndex);
    }, DOUBLE_TAP_MS);
  };

  const lightboxImages: LightboxImage[] = images.map((image) => ({
    url: image.url,
    content: null,
    user_name: owner.name,
    avatar_url: owner.avatarUrl,
    created_at: owner.createdAt,
  }));

  const viewer =
    viewerIndex !== null && lightboxImages.length > 0 ? (
      <ImageViewer
        images={lightboxImages}
        index={Math.min(viewerIndex, lightboxImages.length - 1)}
        onClose={() => setViewerIndex(null)}
        onNavigate={setViewerIndex}
      />
    ) : null;

  if (single) {
    return (
      <>
        <Pressable
          onPress={() => handleImagePress(0)}
          style={[
            styles.imageSingle,
            anchorRatio ? { aspectRatio: anchorRatio } : styles.imageSingleFallback,
            { borderColor: colors.border },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Open image"
        >
          <Image source={{ uri: images[0].url }} style={styles.threadImage} resizeMode="contain" />
        </Pressable>
        {viewer}
      </>
    );
  }

  return (
    <View style={[styles.carousel, { borderColor: colors.border, backgroundColor: colors.surfaceRaised }]}>
      <ScrollView
        ref={stripRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        // Measured on the viewport itself, inside the border, so a page is
        // exactly one screenful and paging never drifts.
        onLayout={(event) => setContainerWidth(event.nativeEvent.layout.width)}
        onMomentumScrollEnd={(event) => {
          setIndex(Math.round(event.nativeEvent.contentOffset.x / Math.max(1, pageWidth)));
        }}
      >
        {images.map((image, imageIndex) => (
          <Pressable
            key={`${image.url}-${imageIndex}`}
            onPress={() => handleImagePress(imageIndex)}
            style={{ width: pageWidth, height: pageHeight }}
            accessibilityRole="button"
            accessibilityLabel={`Open image ${imageIndex + 1} of ${images.length}`}
          >
            {/* Contain, not cover: the web never crops a thread image. */}
            <Image source={{ uri: image.url }} style={styles.threadImage} resizeMode="contain" />
          </Pressable>
        ))}
      </ScrollView>

      {/* Counter, top-right — the Instagram-style "1/3". */}
      <View style={styles.carouselCounter} pointerEvents="none">
        <Text style={styles.carouselCounterText}>
          {Math.min(index + 1, images.length)}/{images.length}
        </Text>
      </View>

      {/* Carousel dots — the web's pill of clickable dots, centred at the
          bottom edge of the viewport. */}
      <View style={styles.carouselDotsRow} pointerEvents="box-none">
        <View style={styles.carouselDots}>
          {images.map((image, dotIndex) => {
            const active = dotIndex === index;
            return (
              <Pressable
                key={`${image.url}-dot-${dotIndex}`}
                onPress={() => scrollToPage(dotIndex)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Go to image ${dotIndex + 1} of ${images.length}`}
                accessibilityState={{ selected: active }}
                style={styles.carouselDotButton}
              >
                <View
                  style={[
                    styles.carouselDot,
                    { backgroundColor: active ? '#FFFFFF' : 'rgba(255, 255, 255, 0.4)' },
                  ]}
                />
              </Pressable>
            );
          })}
        </View>
      </View>

      {viewer}
    </View>
  );
}

function DetailRow({ icon, text }: { icon: React.ComponentProps<typeof Feather>['name']; text: string }) {
  const colors = useColors();
  return (
    <View style={styles.eventMeta}>
      <Feather name={icon} size={16} color={colors.accent} />
      <Text style={[styles.eventMetaText, { color: colors.foregroundMuted }]}>{text}</Text>
    </View>
  );
}

function Action({ icon, label, active, activeColor = 'accent', compact = false, onPress, accessibilityLabel }: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  active?: boolean;
  activeColor?: 'like' | 'accent';
  /** The web renders the comment count one step smaller than the like count. */
  compact?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const colors = useColors();
  // Inactive actions sit on the web's foreground-subtle, and the heart is the
  // only one that turns pink when it lights up.
  const tint = active
    ? activeColor === 'like'
      ? colors.like
      : colors.accent
    : colors.foregroundSubtle;
  // The heart and the comment bubble lead the footer and read a step larger
  // than the secondary actions (save, RSVP), which keep the web's 16px.
  const iconSize = icon === 'heart' || icon === 'message-circle' ? 20 : 16;
  return (
    <Pressable
      onPress={(event) => { event.stopPropagation(); onPress(); }}
      style={styles.action}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: Boolean(active) }}
    >
      {icon === 'heart' ? (
        <HeartIcon size={iconSize} active={Boolean(active)} color={colors.foregroundSubtle} />
      ) : (
        <Feather name={icon} size={iconSize} color={tint} />
      )}
      <Text style={[styles.actionText, compact ? styles.actionTextCompact : null, { color: tint }]}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Natural aspect ratio of a remote image, or null while it is unknown.
 * Used by `MediaCarousel` so a single attachment is never cropped.
 */
function useImageAspectRatio(url?: string): number | null {
  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => {
    setRatio(null);
    if (!url) return;
    let active = true;
    Image.getSize(
      url,
      (width, height) => {
        if (active && width > 0 && height > 0) setRatio(width / height);
      },
      () => undefined,
    );
    return () => { active = false; };
  }, [url]);
  return ratio;
}

const styles = StyleSheet.create({
  // Web thread card: rounded-xl border bg-background-subtle px-5 py-5 — a flat
  // bordered card rather than a shadowed surface.
  card: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  likeBurst: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    // Above the photo grid it is drawn over.
    zIndex: 1,
  },
  cover: { width: '100%', height: 170 },
  cardBody: { padding: 20, gap: 12 },

  communityLabel: {
    flexShrink: 1,
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  communityLabelText: { fontFamily: 'Geist_500Medium', fontSize: 11 },
  communityLabelAvatar: { width: 16, height: 16, borderRadius: 8 },
  communityLabelName: { flexShrink: 1, fontFamily: 'Geist_500Medium', fontSize: 11 },

  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  authorCopy: { flex: 1 },
  authorLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  author: { flexShrink: 1, fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  meta: { fontSize: 11, fontFamily: 'Geist_600SemiBold' },
  secondaryLabel: { fontSize: 11, fontFamily: 'Geist_600SemiBold', marginTop: 1 },
  readMore: { marginTop: 2, fontSize: 14, fontFamily: 'Geist_500Medium' },

  menuButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  menuBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  optionsSheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingVertical: 6,
    paddingBottom: 18,
    elevation: 12,
    shadowOpacity: 0.3,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: -4 },
  },
  optionRow: { minHeight: 52, paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', gap: 14 },
  optionText: { fontFamily: 'Geist_500Medium', fontSize: 15 },
  optionDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 18 },

  // In-sheet delete confirm — the same shape as the message and chat-actions
  // sheets: centred title and reason, then a destructive action and Cancel.
  confirmHeader: {
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  confirmTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 16 },
  confirmBody: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 17,
  },
  confirmError: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 17,
  },
  confirmAction: {
    minHeight: 52,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  confirmActionText: { fontFamily: 'Geist_600SemiBold', fontSize: 15 },

  // Web card body: font-display text-sm font-normal leading-snug.
  cardTitle: { fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 19 },
  description: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19 },
  eventMeta: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  eventMetaStack: { gap: 6 },
  eventMetaText: { flex: 1, fontFamily: 'Geist_400Regular', fontSize: 13 },
  linkButton: { minHeight: 44, borderRadius: 12, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  linkText: { flex: 1, fontFamily: 'Geist_500Medium', fontSize: 13 },

  // No divider above the footer: the web card runs the engagement row straight
  // off the body, separated by spacing alone.
  actions: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    // The web footer spaces the engagement cluster with gap-4 before the
    // right-aligned community attribution.
    gap: 16,
  },
  action: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 6 },
  // Web footer counts: font-body text-sm font-semibold; the comment count is
  // one step smaller (text-xs).
  actionText: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  actionTextCompact: { fontSize: 12 },

  carousel: {
    width: '100%',
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  carouselCounter: {
    position: 'absolute',
    top: 10,
    right: 10,
    zIndex: 2,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  carouselCounterText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontFamily: 'Geist_600SemiBold',
  },
  // Centred along the bottom edge, over the photo — the web's dot pill.
  carouselDotsRow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 10,
    alignItems: 'center',
    zIndex: 2,
  },
  carouselDots: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  carouselDotButton: {
    width: 12,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  carouselDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  imageSingle: {
    width: '100%',
    maxHeight: 480,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  imageSingleFallback: { height: 220 },
  threadImage: { width: '100%', height: '100%' },

  detailRoot: { flex: 1 },
  flex: { flex: 1 },
  detailLoading: { alignItems: 'center', justifyContent: 'center' },
  detailHeader: {
    minHeight: 64,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  detailHeaderTitle: { flex: 1, fontFamily: 'Geist_600SemiBold', fontSize: 19 },
  detailContent: { padding: 18, gap: 16 },
  detailCover: { width: '100%', height: 230, borderRadius: 14 },
  detailTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 25, lineHeight: 32 },
  // The detail body for a thread reads like the web detail card: same
  // text-sm / normal weight / leading-snug as the feed card.
  detailThreadBody: { fontFamily: 'Geist_400Regular', fontSize: 14, lineHeight: 19 },
  detailDescription: { fontFamily: 'Geist_400Regular', fontSize: 16, lineHeight: 25 },
  detailPanel: { borderRadius: 14, padding: 14, gap: 12 },
  primaryLink: {
    height: 48,
    borderRadius: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryLinkText: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
});
