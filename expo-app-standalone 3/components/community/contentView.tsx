import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  Image as RNImage,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useIsFocused } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import ReanimatedAnimated from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';
import { CommentGlyph } from '@/components/communities/CommentGlyph';
import { CommunityIcon } from '@/components/communities/CommunityIcon';
import { useColors } from '@/hooks/useColors';
import { useChatImeLayout } from '@/hooks/useChatImeLayout';
import { useImageAspectRatio } from '@/hooks/useImageAspectRatio';
import { cachedImageAspectRatio, rememberImageAspectRatio } from '@/lib/imageAspectRatio';
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
  ThreadAttachment,
  collapsedBodyLines,
  contentAuthor,
  contentLabel,
  contentSecondaryLabel,
  formatRelativeDate,
  getLinkPreview,
  linkPreviewDomain,
  sendEventRsvp,
  setContentAction,
  threadBody,
  voteOnThreadPoll,
  type LinkPreviewData,
} from '@/lib/communityContent';
import { communityStore } from '@/lib/communityStore';
import type { EventJoinAnswers } from '@/lib/eventJoinQuestions';
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
import { PersonAvatar } from '@/components/PersonAvatar';
import { HeartIcon } from './HeartIcon';
import { VideoPlayerModal } from './VideoPlayerModal';
import { EventTicket } from './EventTicket';
import { ContentReportModal } from './ContentReportModal';
import { CommunityPreviewSheet } from './CommunityPreviewSheet';
import { REPORT_CONTENT_TYPE_BY_KIND } from '@/lib/contentReports';
import { eventShareUrl } from '@/lib/contentLinks';
import { joinVideoPlayback, leaveVideoPlayback } from '@/lib/videoPlayback';

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
 * Events keep their RSVP where the web card puts it: the wide call to action
 * on the ticket's stub, not a footer chip.
 */
export const FOOTER_ACTIONS_BY_KIND: Record<ContentKind, ActionDefinition[]> = {
  threads: [LIKE],
  showcase: [LIKE],
  events: [LIKE],
  resources: [RESOURCE_LIKE],
};

/**
 * Actions that live outside the footer but still answer to `actionDefinition`
 * — the event ticket's RSVP is driven by the stub's own button.
 */
const TICKET_ACTIONS_BY_KIND: Partial<Record<ContentKind, ActionDefinition[]>> = {
  events: [RSVP],
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
  const all = [
    ...FOOTER_ACTIONS_BY_KIND[kind],
    MENU_ACTION_BY_KIND[kind],
    ...(TICKET_ACTIONS_BY_KIND[kind] ?? []),
  ].filter(Boolean) as ActionDefinition[];
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
  /**
   * Write one interaction's state into the card from outside the tap path —
   * the RSVP, whose dialog owns the request, its spinner and its error, and so
   * drives the optimistic flip and the server's answer itself.
   */
  applyResult: (
    item: CommunityContent,
    kind: ContentKind,
    action: ContentAction,
    value: boolean,
    count?: number,
  ) => void;
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
export function useContentActions(
  onCacheMutation?: (item: CommunityContent, patch: Record<string, unknown>) => void,
): ContentActionsApi {
  const [overrides, setOverrides] = useState<Record<string, ActionOverride>>({});
  const [pollOverrides, setPollOverrides] = useState<Record<string, PollViewState>>({});
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [lastError, setLastError] = useState<string | null>(null);
  const coalescersRef = useRef(new Map<string, BooleanIntentCoalescer>());
  const onCacheMutationRef = useRef(onCacheMutation);

  useEffect(() => {
    onCacheMutationRef.current = onCacheMutation;
  }, [onCacheMutation]);

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
            const patch: Record<string, unknown> = { [definition.field]: result.value };
            if (definition.countField && typeof result.count === 'number') {
              patch[definition.countField] = result.count;
            }
            onCacheMutationRef.current?.(item, patch);
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

  const applyResult = useCallback(
    (
      item: CommunityContent,
      kind: ContentKind,
      actionName: ContentAction,
      value: boolean,
      count?: number,
    ) => {
      setOverrides((current) => ({
        ...current,
        [`${kind}:${item.id}:${actionName}`]: { value, count },
      }));
    },
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
        onCacheMutationRef.current?.(item, {
          poll_vote_counts: result.counts,
          poll_user_vote: result.userVote,
          poll_undo_used: result.undoUsed,
        });
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
        onCacheMutationRef.current?.(item, {
          poll_vote_counts: result.counts,
          poll_user_vote: result.userVote,
          poll_undo_used: result.undoUsed,
        });
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

  const clearError = useCallback(() => setLastError(null), []);

  // Memoized as one API object: a fresh literal every render used to make every
  // memoized card look stale, so a pull-to-refresh or a selection change
  // re-rendered every mounted card even though no interaction state moved.
  // The functions below only change when optimistic state or the error does.
  return useMemo<ContentActionsApi>(() => ({
    action,
    isActive,
    countFor,
    commentCountFor,
    setCommentCount,
    applyResult,
    reset,
    lastError,
    clearError,
    pollState,
    votePoll,
    undoPoll,
    resetPoll,
    applyPollUpdate,
  }), [
    action,
    applyPollUpdate,
    applyResult,
    clearError,
    commentCountFor,
    countFor,
    isActive,
    lastError,
    pollState,
    reset,
    resetPoll,
    setCommentCount,
    undoPoll,
    votePoll,
  ]);
}

// ---------------------------------------------------------------------------
// The RSVP the ticket's dialogs send
// ---------------------------------------------------------------------------

/**
 * The writer behind the ticket's confirm and questions dialogs — the mobile
 * shape of the web card's `commitRsvp`.
 *
 * The card flips first, the request goes out, and the server's answer replaces
 * the guess. A failure puts the original state back and hands the reason to the
 * dialog that asked, which stays open with it. An RSVP is also the door into the
 * event's group chat, so the room list is told to re-read itself instead of
 * waiting for its next fetch.
 */
function useEventRsvpSender(
  event: CommunityEvent | null,
  rsvped: boolean,
  goingCount: number,
  actions: ContentActionsApi,
) {
  const apply = useCallback(
    (value: boolean, count?: number) => {
      if (event) actions.applyResult(event, 'events', 'rsvp', value, count);
    },
    [actions, event],
  );

  return useCallback(
    async (answers: EventJoinAnswers | null) => {
      if (!event || !event.community_id) return;
      const next = !rsvped;
      apply(next, Math.max(0, goingCount + (next ? 1 : -1)));
      try {
        const result = await sendEventRsvp(event.community_id, event.id, answers);
        apply(result.value, result.count);
        if (result.chatCommunityId) {
          communityStore.notifyCommunityChanged({ kind: 'refresh' });
        }
      } catch (error) {
        apply(rsvped, goingCount);
        throw error;
      }
    },
    [apply, event, goingCount, rsvped],
  );
}

// ---------------------------------------------------------------------------
// Resource link preview
// ---------------------------------------------------------------------------

const previewCache = new Map<string, LinkPreviewData | null>();

/** Link metadata for a resource URL, shared by every card and detail page. */
export function useResourceLinkPreview(url?: string) {
  const [data, setData] = useState<LinkPreviewData | null>(null);
  useEffect(() => {
    if (!url) { setData(null); return; }
    const cached = previewCache.get(url);
    if (cached !== undefined) { setData(cached); return; }
    let active = true;
    getLinkPreview(url)
      .then((result) => { previewCache.set(url, result); if (active) setData(result); })
      .catch(() => previewCache.set(url, null));
    return () => { active = false; };
  }, [url]);
  return data;
}

/**
 * The web resource card's link tile: the page's own title, description and
 * social image, credited to its domain. The whole tile opens the URL — the
 * web card's `<a>`.
 */
function ResourcePreviewTile({
  data,
  onPress,
}: {
  data: LinkPreviewData;
  onPress: () => void;
}) {
  const colors = useColors();
  const [faviconFailed, setFaviconFailed] = useState(false);
  const domain = linkPreviewDomain(data.url);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={`Open ${domain}`}
      style={[
        styles.previewTile,
        { borderColor: colors.border, backgroundColor: colors.surfaceRaised },
      ]}
    >
      <View style={styles.previewTileCopy}>
        {data.title ? (
          <Text
            numberOfLines={2}
            style={[styles.previewTileTitle, { color: colors.foreground }]}
          >
            {data.title}
          </Text>
        ) : null}
        {data.description ? (
          <Text
            numberOfLines={3}
            style={[styles.previewTileDescription, { color: colors.foregroundMuted }]}
          >
            {data.description}
          </Text>
        ) : null}
        <View style={styles.previewTileDomainRow}>
          {faviconFailed ? (
            <Feather name="globe" size={11} color={colors.foregroundSubtle} />
          ) : (
            <RNImage
              source={{ uri: `https://www.google.com/s2/favicons?domain=${domain}&sz=32` }}
              style={styles.previewTileFavicon}
              onError={() => setFaviconFailed(true)}
            />
          )}
          <Text
            numberOfLines={1}
            style={[styles.previewTileDomain, { color: colors.foregroundSubtle }]}
          >
            {domain}
          </Text>
        </View>
      </View>
      {data.image ? (
        <ExpoImage
          source={{ uri: data.image }}
          style={[styles.previewTileImage, { backgroundColor: colors.surface }]}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={data.image}
        />
      ) : null}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

/**
 * Feed screens flip this off while a card detail covers the list, so the
 * inline videos underneath stop instead of playing behind the modal. Kept in
 * context rather than in `renderItem`'s props: selection changes should
 * re-render the cards, not recreate the list's render function.
 */
const ContentPlaybackContext = createContext(true);

export function ContentPlaybackProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <ContentPlaybackContext.Provider value={enabled}>
      {children}
    </ContentPlaybackContext.Provider>
  );
}

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
  /** Manager with this kind's moderation grant — offers Delete on others' cards. */
  canModerate?: boolean;
  /** Card is on screen — its inline video may autoplay. */
  videoActive?: boolean;
  /** List position — the topmost active video owns playback. */
  videoRank?: number;
}

export const ContentCard = React.memo(function ContentCard({
  item,
  kind,
  currentUserId,
  actions,
  communityName,
  communityImage,
  onComments,
  onEdit,
  onDelete,
  canModerate = false,
  videoActive = true,
  videoRank = 0,
}: ContentCardProps) {
  const colors = useColors();
  const playbackEnabled = useContext(ContentPlaybackContext);
  const router = useRouter();
  const thread = kind === 'threads' ? item as CommunityThread : null;
  const event = kind === 'events' ? item as CommunityEvent : null;
  const resource = kind === 'resources' ? item as CommunityResource : null;
  const showcase = kind === 'showcase' ? item as CommunityShowcase : null;
  const author = contentAuthor(item);
  // The web `PostAuthorMeta` links the avatar and name whenever the API
  // hydrated the author — the card itself has no route of its own. Your own
  // author opens the profile tab; other members open their read-only page.
  const authorProfileId = author ? item.user_id : null;
  const openAuthorProfile = useCallback(() => {
    if (!authorProfileId) return;
    hapticSelection();
    if (authorProfileId === currentUserId) {
      router.push('/profile');
      return;
    }
    router.push({ pathname: '/member/[id]', params: { id: authorProfileId } });
  }, [authorProfileId, currentUserId, router]);
  const images = (thread?.attachments ?? [])
    .filter((attachment) => attachment.type.startsWith('image/'));
  const showcaseMedia = showcase ? showcaseMediaForPost(showcase) : [];
  const resourcePreview = useResourceLinkPreview(resource?.url);
  // Showcase media renders through the carousel only — its first attachment is
  // already the cover, so a separate banner would show the same image twice.
  // Resources render the link tile instead of a cover, like the web card.
  // Events draw their poster inside the ticket below.
  const isOwner = item.user_id === currentUserId;

  // The body text each kind puts on its card, mirroring the web cards: a thread
  // and a showcase show their body (the whole post lives in `title` on the web)
  // collapsed behind "Read more", an event shows its description above the
  // ticket (its title is the ticket's own), and a resource clamps its
  // description to 3 lines.
  const primaryBody = resource
    ? resource.description || resource.title
    : kind === 'threads' && thread
      ? threadBody(thread)
      : item.title;
  const secondaryBody = kind === 'events' ? item.description : null;
  const primaryLines =
    kind === 'threads' || kind === 'showcase' ? collapsedBodyLines(kind, item)
      : kind === 'resources' ? 3
        : undefined;
  const pollState = thread?.poll ? actions.pollState(item) : null;
  const eventRsvped = event ? actions.isActive(item, 'events', 'rsvp') : false;
  const eventGoingCount = event ? actions.countFor(item, 'events', 'rsvp') : 0;
  const sendRsvp = useEventRsvpSender(event, eventRsvped, eventGoingCount, actions);

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
      style={[styles.card, { backgroundColor: colors.backgroundSubtle }]}
    >
      <View style={styles.cardBody}>
        {/* Author meta — name and relative date on one line, the category as
            the muted second line, exactly like the web `PostAuthorMeta`. */}
        <View style={styles.authorRow}>
          <Pressable
            onPress={openAuthorProfile}
            disabled={!authorProfileId}
            hitSlop={6}
            accessibilityRole="link"
            accessibilityLabel={`Open ${author?.name ?? 'the author'}'s profile`}
          >
            <PersonAvatar name={author?.name} url={author?.avatar_url} size={40} />
          </Pressable>
          <View style={styles.authorCopy}>
            <View style={styles.authorLine}>
              <Pressable
                onPress={openAuthorProfile}
                disabled={!authorProfileId}
                hitSlop={6}
                style={styles.authorNamePress}
                accessibilityRole="link"
              >
                <Text style={[styles.author, { color: colors.foreground }]} numberOfLines={1}>
                  {author?.name ?? 'Community member'}
                </Text>
              </Pressable>
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
            canModerate={canModerate}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </View>

        {event ? (
          <>
            {/* The web event card leads with the description, then the ticket;
                the event's title lives inside the ticket. */}
            {secondaryBody ? (
              <CollapsibleBody text={secondaryBody} textStyle={styles.description} collapsedLines={2} />
            ) : null}
            <EventTicket
              event={event}
              goingCount={eventGoingCount}
              rsvped={eventRsvped}
              notchColor={colors.backgroundSubtle}
              communityName={communityName ?? null}
              isOwner={isOwner}
              onRsvp={sendRsvp}
            />
          </>
        ) : (
          <CollapsibleBody
            text={primaryBody}
            textStyle={styles.cardTitle}
            collapsedLines={primaryLines}
            expandable={kind === 'threads' || kind === 'showcase' || kind === 'resources'}
          />
        )}
        {thread?.poll && pollState ? (
          <ThreadPollView
            poll={thread.poll}
            state={pollState}
            hideQuestion={thread.poll.question.trim() === thread.title.trim()}
            onVote={(optionIndex) => actions.votePoll(item, optionIndex)}
            onUndo={() => actions.undoPoll(item)}
          />
        ) : null}
        {showcaseMedia.length ? (
          <MediaCarousel
            media={showcaseMedia}
            owner={{
              name: author?.name ?? null,
              avatarUrl: author?.avatar_url ?? null,
              createdAt: item.created_at,
            }}
            videoActive={playbackEnabled && videoActive}
            videoRank={videoRank}
            onDoubleTap={likeFromDoubleTap}
            holdLayout
          />
        ) : images.length ? (
          <MediaCarousel
            media={images}
            owner={{
              name: author?.name ?? null,
              avatarUrl: author?.avatar_url ?? null,
              createdAt: item.created_at,
            }}
            videoActive={playbackEnabled && videoActive}
            videoRank={videoRank}
            onDoubleTap={likeFromDoubleTap}
            holdLayout
          />
        ) : null}

        {resource && resourcePreview && (resourcePreview.title || resourcePreview.description || resourcePreview.image) ? (
          <ResourcePreviewTile
            data={resourcePreview}
            onPress={() => { void Linking.openURL(resource.url); }}
          />
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
});

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
  const [previewOpen, setPreviewOpen] = useState(false);
  return (
    <>
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
          accessibilityLabel="Comments"
          onPress={() => {
            hapticSelection();
            onComments(item);
          }}
        />

        {/* Community attribution — the web keeps the engagement cluster on the
            left and puts "posted in <community>" at the bottom-right. Tapping it
            opens the community preview in place, exactly like the web label. */}
        {communityName ? (
          <Pressable
            onPress={(pressEvent) => {
              pressEvent.stopPropagation();
              hapticSelection();
              setPreviewOpen(true);
            }}
            style={styles.communityLabel}
            accessibilityRole="button"
            accessibilityLabel={`Posted in ${communityName}. Open community preview`}
          >
            <Text style={[styles.communityLabelText, { color: colors.foregroundSubtle }]} numberOfLines={1}>
              posted in
            </Text>
            {communityAvatar ? (
              <RNImage source={{ uri: communityAvatar }} style={styles.communityLabelAvatar} />
            ) : (
              <CommunityIcon size={16} iconSize={9} />
            )}
            <Text
              style={[styles.communityLabelName, { color: colors.foregroundMuted }]}
              numberOfLines={1}
            >
              {communityName}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {communityName ? (
        <CommunityPreviewSheet
          visible={previewOpen}
          communityId={item.community_id}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
    </>
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
  canModerate = false,
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
  canModerate?: boolean;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const canCompose = Boolean(
    visible && isFocused && item &&
    (kind === 'events' || (item as { allow_replies?: boolean }).allow_replies !== false),
  );
  const imeLayout = useChatImeLayout(canCompose, { top: 0, bottom: 0 });
  const resource = kind === 'resources' ? (item as CommunityResource | null) : null;
  const resourcePreview = useResourceLinkPreview(resource?.url);
  // The page always opens at its own start — the reader asked for this post,
  // not for its comments. Tapping the footer's comment count still jumps to
  // the discussion, so its offset is all this needs to know.
  const scrollRef = useRef<ScrollView>(null);
  const [commentsY, setCommentsY] = useState(0);
  const sectionRef = useRef<CommentSectionHandle>(null);
  // Who the pinned composer is aimed at — null means a top-level comment.
  const [replyTarget, setReplyTarget] = useState<CommunityComment | null>(null);
  // Some screens keep the sheet mounted between posts, so a previously read
  // page must not carry its scroll offset into the next open.
  useEffect(() => {
    if (visible) {
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      setReplyTarget(null);
    } else {
      imeLayout.closePanel();
    }
  }, [imeLayout.closePanel, visible, item?.id]);

  // The RSVP sender is a hook, so it has to run before the early return below.
  // Returning a spinner while the row loads and then calling it once the row
  // arrives would change the hook order between renders (React error #310).
  const event = kind === 'events' && item ? (item as CommunityEvent) : null;
  const eventRsvped = event ? actions.isActive(event, 'events', 'rsvp') : false;
  const eventGoingCount = event ? actions.countFor(event, 'events', 'rsvp') : 0;
  const sendRsvp = useEventRsvpSender(event, eventRsvped, eventGoingCount, actions);

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
  const showcase = kind === 'showcase' ? item as CommunityShowcase : null;
  const author = contentAuthor(item);
  const images = (thread?.attachments ?? [])
    .filter((attachment) => attachment.type.startsWith('image/'));
  const showcaseMedia = showcase ? showcaseMediaForPost(showcase) : [];
  const files = (thread?.attachments ?? []).filter((attachment) => !attachment.type.startsWith('image/'));
  // Showcase media lives in the carousel below the body; a cover copy on top
  // would repeat the first attachment. Resources show the link tile instead.
  // Events draw their poster inside the ticket that takes the body's place.
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
            canModerate={canModerate}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        </View>

        <View style={styles.flex}>
          <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={[styles.detailContent, { paddingBottom: 24 }]}
          keyboardShouldPersistTaps="handled"
        >
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

          {event ? (
            <>
              {/* The web event page leads with the description, then the
                  ticket — the title and schedule live inside it. */}
              {event.description?.trim() ? (
                <Text style={[styles.detailThreadBody, { color: colors.foreground }]}>
                  {bodyWithLinks(event.description, colors.link)}
                </Text>
              ) : null}
              <EventTicket
                event={event}
                goingCount={eventGoingCount}
                rsvped={eventRsvped}
                variant="detail"
                notchColor={colors.background}
                communityName={communityName ?? null}
                isOwner={isOwner}
                onRsvp={sendRsvp}
              />
            </>
          ) : (
            <>
              {/* Threads carry the whole post in the body and showcase titles
                  are card text on the web too, so both keep the compact type
                  here. Resources keep the same compact body as their card. */}
              <Text
                style={[
                  thread || showcase || resource ? styles.detailThreadBody : styles.detailTitle,
                  { color: colors.foreground },
                ]}
              >
                {bodyWithLinks(
                  thread ? threadBody(thread) : resource ? resource.description || resource.title : item.title,
                  colors.link,
                )}
              </Text>
              {!thread && !resource && item.description ? (
                <Text style={[styles.detailDescription, { color: colors.foregroundMuted }]}>
                  {bodyWithLinks(item.description, colors.link)}
                </Text>
              ) : null}
            </>
          )}
          {resource && resourcePreview && (resourcePreview.title || resourcePreview.description || resourcePreview.image) ? (
            <ResourcePreviewTile
              data={resourcePreview}
              onPress={() => { void Linking.openURL(resource.url); }}
            />
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
          {showcaseMedia.length ? (
            <MediaCarousel
              media={showcaseMedia}
              owner={{
                name: author?.name ?? null,
                avatarUrl: author?.avatar_url ?? null,
                createdAt: item.created_at,
              }}
            />
          ) : images.length ? (
            <MediaCarousel
              media={images}
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
          <ReanimatedAnimated.View
            pointerEvents="none"
            style={imeLayout.listSpacerStyle}
          />

        {allowReplies ? (
          <ReanimatedAnimated.View
            pointerEvents="box-none"
            style={[styles.commentDock, imeLayout.dockStyle]}
          >
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
              imeLayout={imeLayout}
            />
          </ReanimatedAnimated.View>
        ) : null}
        </View>
        <View style={{ height: insets.bottom, backgroundColor: colors.background }} />
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
 * Mirrors the web dropdown row for row:
 *   Save/Unsave (every card)
 *   Share (events only)
 *   Edit (the author, while an event is still ahead)
 *   Delete (the author, or a manager holding this kind's moderation grant —
 *           including on an event that already ended)
 *   Report (everyone else, flipping to "Reported" once acknowledged)
 *
 * Save is where saving lives, deliberately not in the footer. Delete confirms
 * in-sheet, like the message and chat-actions sheets.
 */
export function ContentOptionsMenu({
  item,
  kind,
  actions,
  isOwner,
  canModerate = false,
  onEdit,
  onDelete,
}: {
  item: CommunityContent;
  kind: ContentKind;
  actions: ContentActionsApi;
  isOwner: boolean;
  /** Manager with this kind's moderation grant — Delete on others' cards. */
  canModerate?: boolean;
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
  const [reportOpen, setReportOpen] = useState(false);
  const [reported, setReported] = useState(false);
  const saveAction = MENU_ACTION_BY_KIND[kind];
  const saved = saveAction ? actions.isActive(item, kind, saveAction.action) : false;
  const noun = contentLabel(kind).toLowerCase();
  const event = kind === 'events' ? (item as CommunityEvent) : null;
  // The web menu's window rule: an event whose start has gone by can no longer
  // be rescheduled (the form refuses a past start), but it can still be taken
  // down — deleting a finished event is exactly when a host wants the row.
  const past = event
    ? new Date(event.end_date ?? event.event_date).getTime() < Date.now()
    : false;
  const showEdit = isOwner && Boolean(onEdit) && !past;
  const showDelete = (isOwner || canModerate) && Boolean(onDelete);
  const showReport = !isOwner && !canModerate;

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

  const share = () => {
    if (!event) return;
    close();
    // Let the action sheet finish dismissing before the system share sheet
    // presents; on iOS the two cannot present in the same frame.
    setTimeout(() => {
      void Share.share({
        title: event.title,
        message: eventShareUrl(event.community_id, event.id),
      }).catch(() => {
        // A dismissed system sheet is not an error.
      });
    }, 240);
  };

  const openReport = () => {
    close();
    // Two Modals cannot present in the same frame on iOS; let the action sheet
    // finish dismissing before the report wizard slides in.
    setTimeout(() => setReportOpen(true), 240);
  };

  return (
    <>
      <Pressable
        onPress={(pressEvent) => {
          pressEvent.stopPropagation();
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
                  color={saved ? colors.accent : colors.foreground}
                />
                <Text style={[styles.optionText, { color: saved ? colors.accent : colors.foreground }]}>
                  {saved ? 'Unsave' : 'Save'}
                </Text>
              </Pressable>
            ) : null}

            {!confirmingDelete && event ? (
              <>
                <View style={[styles.optionDivider, { backgroundColor: colors.borderSubtle }]} />
                <Pressable onPress={share} style={styles.optionRow} accessibilityRole="button">
                  <Feather name="share-2" size={16} color={colors.foreground} />
                  <Text style={[styles.optionText, { color: colors.foreground }]}>Share</Text>
                </Pressable>
              </>
            ) : null}

            {!confirmingDelete && (showEdit || showDelete || showReport) ? (
              <>
                {!event ? (
                  <View style={[styles.optionDivider, { backgroundColor: colors.borderSubtle }]} />
                ) : null}
                {showEdit ? (
                  <Pressable
                    onPress={() => {
                      hapticSelection();
                      close();
                      onEdit?.(item);
                    }}
                    style={styles.optionRow}
                    accessibilityRole="button"
                  >
                    <Feather name="edit-2" size={16} color={colors.foreground} />
                    <Text style={[styles.optionText, { color: colors.foreground }]}>Edit</Text>
                  </Pressable>
                ) : null}
                {showDelete ? (
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
                ) : null}
                {showReport ? (
                  <Pressable
                    onPress={() => {
                      hapticSelection();
                      openReport();
                    }}
                    disabled={reported}
                    style={styles.optionRow}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: reported }}
                  >
                    <Feather
                      name="flag"
                      size={16}
                      color={reported ? colors.foregroundSubtle : colors.foreground}
                    />
                    <Text
                      style={[
                        styles.optionText,
                        { color: reported ? colors.foregroundSubtle : colors.foreground },
                      ]}
                    >
                      {reported ? 'Reported' : 'Report'}
                    </Text>
                  </Pressable>
                ) : null}
              </>
            ) : null}
          </View>
        </Pressable>
      </Modal>

      <ContentReportModal
        visible={reportOpen}
        contentType={REPORT_CONTENT_TYPE_BY_KIND[kind]}
        contentId={item.id}
        onClose={() => setReportOpen(false)}
        onReported={() => setReported(true)}
      />
    </>
  );
}

/**
 * Body text with tappable URLs — the mobile counterpart of the web
 * `renderWithLinks`, so links inside a post read blue on both clients.
 */
const BODY_URL_PATTERN = /(https?:\/\/[^\s<>"]+)/g;

function bodyWithLinks(text: string, linkColor: string) {
  const pieces = text.split(BODY_URL_PATTERN);
  if (pieces.length === 1) return text;
  return pieces.map((piece, index) =>
    index % 2 === 0 ? (
      piece
    ) : (
      <Text
        key={`body-url-${index}`}
        style={{ color: linkColor, textDecorationLine: 'underline' }}
        onPress={(event) => {
          event.stopPropagation();
          void Linking.openURL(piece).catch(() => {
            /* ignore un-openable links */
          });
        }}
      >
        {piece}
      </Text>
    ),
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
        {bodyWithLinks(text, colors.link)}
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

/** One image or video on a card — the shape both threads and showcase share. */
type MediaEntry = { url: string; type?: string; poster?: string; name?: string };

function isVideoAttachment(media: { type?: string }): boolean {
  return (media.type ?? '').startsWith('video/');
}

/** A showcase post's attachments, with the legacy cover standing in as one image. */
function showcaseMediaForPost(post: CommunityShowcase): MediaEntry[] {
  if (Array.isArray(post.attachments) && post.attachments.length) return post.attachments;
  return post.image_url
    ? [{ name: post.title, url: post.image_url, type: 'image/jpeg' }]
    : [];
}

/**
 * A post's media, at the bottom of its body.
 *
 * One image keeps its natural aspect ratio; several become a swipeable
 * carousel with a counter, rather than a cropped tile grid. Tapping an image
 * opens the app's own lightbox — the same one the community chat uses — never
 * the system browser, so images stay inside the app. Showcase videos play
 * inline — muted, looping — with a volume toggle; tapping one opens the
 * full player with transport controls and fullscreen rotation.
 */
export function MediaCarousel({
  media,
  owner,
  /** The card is on screen and nothing covers it — the video may play. */
  videoActive = true,
  /** List position — the topmost active video owns playback. */
  videoRank = 0,
  /** Double tap on a photo: like the post instead of opening the viewer. */
  onDoubleTap,
  /** Feed cards latch their mount height so a late image never resizes them. */
  holdLayout = false,
}: {
  media: MediaEntry[];
  /** The poster — the lightbox header's name, avatar and date, as in chat. */
  owner: { name: string | null; avatarUrl: string | null; createdAt: string };
  videoActive?: boolean;
  videoRank?: number;
  onDoubleTap?: () => void;
  holdLayout?: boolean;
}) {
  const colors = useColors();
  const { width: screenWidth } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(0);
  const [index, setIndex] = useState(0);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const stripRef = useRef<ScrollView>(null);
  const single = media.length === 1;
  const imageMedia = media.filter((entry) => !isVideoAttachment(entry));
  // The web's media keeps every image at its natural aspect ratio, capped at
  // 480px tall and never cropped. A carousel takes its height from the first
  // image — the web's invisible sizing anchor — so the card adopts the same
  // shape a single image would and the slides letterbox inside it, just as
  // `object-contain` does there. A video anchors on its poster, else 16:9.
  const anchor = media.find((entry) => !isVideoAttachment(entry))
    ?? media.find((entry) => Boolean(entry.poster));
  const anchorUrl = anchor ? (isVideoAttachment(anchor) ? anchor.poster : anchor.url) : undefined;
  const measuredRatio = useImageAspectRatio(anchorUrl);
  // A list card keeps the shape it mounted with; a cover that only arrives
  // later must not re-flow the row (and everything below it) under a scroll.
  // The next mount reads the ratio the image has cached by then.
  const [latchedRatio] = useState(() => cachedImageAspectRatio(anchorUrl));
  const anchorRatio = holdLayout ? latchedRatio : measuredRatio;
  // One page per item. Before the first layout pass the container's width is
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

  const openViewer = (entry: MediaEntry) => {
    const viewerIndexForEntry = imageMedia.findIndex((image) => image.url === entry.url);
    if (viewerIndexForEntry >= 0) setViewerIndex(viewerIndexForEntry);
  };

  const handleImagePress = (entry: MediaEntry) => {
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
      openViewer(entry);
    }, DOUBLE_TAP_MS);
  };

  const lightboxImages: LightboxImage[] = imageMedia.map((image) => ({
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
    const entry = media[0];
    if (isVideoAttachment(entry)) {
      return (
        <InlineVideo
          entry={entry}
          active={videoActive}
          rank={videoRank}
          style={[
            styles.imageSingle,
            anchorRatio ? { aspectRatio: anchorRatio } : styles.imageSingleFallback,
            { borderColor: colors.border },
          ]}
        />
      );
    }
    return (
      <>
        <Pressable
          onPress={() => handleImagePress(entry)}
          style={[
            styles.imageSingle,
            anchorRatio ? { aspectRatio: anchorRatio } : styles.imageSingleFallback,
            { borderColor: colors.border },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Open image"
        >
          <ExpoImage
            source={{ uri: entry.url }}
            style={styles.threadImage}
            contentFit="contain"
            cachePolicy="memory-disk"
            recyclingKey={entry.url}
            onLoad={({ source }) => {
              rememberImageAspectRatio(entry.url, source.width, source.height);
            }}
          />
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
        {media.map((entry, mediaIndex) =>
          isVideoAttachment(entry) ? (
            <InlineVideo
              key={`${entry.url}-${mediaIndex}`}
              entry={entry}
              active={videoActive && mediaIndex === index}
              rank={videoRank}
              style={{ width: pageWidth, height: pageHeight }}
            />
          ) : (
            <Pressable
              key={`${entry.url}-${mediaIndex}`}
              onPress={() => handleImagePress(entry)}
              style={{ width: pageWidth, height: pageHeight }}
              accessibilityRole="button"
              accessibilityLabel={`Open image ${mediaIndex + 1} of ${media.length}`}
            >
              {/* Contain, not cover: the web never crops a thread image. */}
              <ExpoImage
                source={{ uri: entry.url }}
                style={styles.threadImage}
                contentFit="contain"
                cachePolicy="memory-disk"
                recyclingKey={entry.url}
                onLoad={({ source }) => {
                  rememberImageAspectRatio(entry.url, source.width, source.height);
                }}
              />
            </Pressable>
          ),
        )}
      </ScrollView>

      {/* Counter, top-right — the Instagram-style "1/3". */}
      <View style={styles.carouselCounter} pointerEvents="none">
        <Text style={styles.carouselCounterText}>
          {Math.min(index + 1, media.length)}/{media.length}
        </Text>
      </View>

      {/* Carousel dots — the web's pill of clickable dots, centred at the
          bottom edge of the viewport. */}
      <View style={styles.carouselDotsRow} pointerEvents="box-none">
        <View style={styles.carouselDots}>
          {media.map((entry, dotIndex) => {
            const active = dotIndex === index;
            return (
              <Pressable
                key={`${entry.url}-dot-${dotIndex}`}
                onPress={() => scrollToPage(dotIndex)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Go to item ${dotIndex + 1} of ${media.length}`}
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
    </View>
  );
}

/**
 * How long the inline player survives after its card leaves the viewport.
 * Viewability flips at the 60% mark, so the pull-to-refresh bounce and scroll
 * jitter would otherwise tear the native player down and rebuild it mid-scroll.
 */
const INLINE_PLAYER_UNMOUNT_GRACE_MS = 1200;

/** Inline, muted, looping playback — tap opens the full player. */
function InlineVideo({
  entry,
  active,
  rank,
  style,
}: {
  entry: MediaEntry;
  active: boolean;
  rank: number;
  style: React.ComponentProps<typeof View>['style'];
}) {
  const [muted, setMuted] = useState(true);
  const [showPlayer, setShowPlayer] = useState(false);
  // Only the card the member is actually looking at allocates a native
  // player. Every other mounted video card shows its poster (or a glyph), so
  // scrolling a feed full of videos no longer keeps one decoder alive per row.
  // The player lingers briefly after the card leaves the viewport, paused, so
  // a threshold bounce doesn't rebuild it.
  const [playerMounted, setPlayerMounted] = useState(active);
  useEffect(() => {
    if (active) {
      setPlayerMounted(true);
      return;
    }
    const timer = setTimeout(() => setPlayerMounted(false), INLINE_PLAYER_UNMOUNT_GRACE_MS);
    return () => clearTimeout(timer);
  }, [active]);

  const showInlinePlayer = playerMounted && !showPlayer;
  const poster = entry.poster;
  // The surface renders black between mount and its first presented frame.
  // The poster cover sits *above* the player and only fades once
  // `onFirstFrameRender` says a real frame is on screen, so that black is
  // never visible — not on first play, and not after the player remounts
  // when the member scrolls back to a paused video.
  const posterOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!playerMounted) posterOpacity.setValue(1);
  }, [playerMounted, posterOpacity]);
  const coverFirstFrame = useCallback(() => {
    Animated.timing(posterOpacity, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [posterOpacity]);

  return (
    <View style={[styles.videoThumb, style]}>
      {showInlinePlayer ? (
        <InlineVideoPlayer
          entry={entry}
          active={active}
          rank={rank}
          muted={muted}
          onFirstFrame={coverFirstFrame}
        />
      ) : null}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: '#000000', opacity: posterOpacity },
        ]}
      >
        {poster ? (
          <ExpoImage
            source={{ uri: poster }}
            style={styles.threadImage}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={poster}
            onLoad={({ source }) => {
              rememberImageAspectRatio(poster, source.width, source.height);
            }}
          />
        ) : (
          <View style={[styles.threadImage, styles.videoPosterFallback]}>
            <Feather name="video" size={24} color="rgba(255, 255, 255, 0.72)" />
          </View>
        )}
      </Animated.View>
      <Pressable
        onPress={() => setShowPlayer(true)}
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel={entry.name ? `Open video ${entry.name}` : 'Open video'}
      />
      <Pressable
        onPress={() => setMuted((current) => !current)}
        hitSlop={8}
        style={styles.videoMuteButton}
        accessibilityRole="button"
        accessibilityLabel={muted ? 'Unmute video' : 'Mute video'}
      >
        <Feather name={muted ? 'volume-x' : 'volume-2'} size={16} color="#FFFFFF" />
      </Pressable>
      {showPlayer ? (
        <VideoPlayerModal
          url={entry.url}
          poster={entry.poster}
          title={entry.name}
          onClose={() => setShowPlayer(false)}
        />
      ) : null}
    </View>
  );
}

/** The native player, mounted only while its card owns inline playback. */
function InlineVideoPlayer({
  entry,
  active,
  rank,
  muted,
  onFirstFrame,
}: {
  entry: MediaEntry;
  active: boolean;
  rank: number;
  muted: boolean;
  onFirstFrame: () => void;
}) {
  const focused = useIsFocused();
  const player = useVideoPlayer(entry.url, (instance) => {
    instance.loop = true;
    instance.muted = muted;
  });
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  // Playback follows the viewport, like the web player's IntersectionObserver.
  // The coordinator lets only one of the on-screen videos run, so two
  // soundtracks never overlap.
  const wantsPlay = active && focused && appActive;
  useEffect(() => {
    if (!wantsPlay) {
      player.pause();
      return;
    }
    const candidate = { rank, play: () => player.play(), pause: () => player.pause() };
    joinVideoPlayback(candidate);
    return () => leaveVideoPlayback(rank, candidate.pause);
  }, [player, rank, wantsPlay]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <VideoView
        player={player}
        // TextureView composites in the normal hierarchy, so the poster above
        // it can cover the surface completely (a SurfaceView punches a black
        // hole through the hierarchy instead).
        surfaceType="textureView"
        style={styles.threadImage}
        nativeControls={false}
        contentFit="cover"
        fullscreenOptions={{ enable: false }}
        // Explicit: Android's default ExoPlayer shutter is black. The poster
        // cover is what hides the load, not the shutter.
        useExoShutter={false}
        // The authoritative “a frame is on screen” signal — the cover fades
        // only when this fires. Time-based guesses still showed black first.
        onFirstFrameRender={onFirstFrame}
      />
    </View>
  );
}

function Action({ icon, label, active, activeColor = 'accent', onPress, accessibilityLabel }: {
  icon: React.ComponentProps<typeof Feather>['name'];
  label: string;
  active?: boolean;
  activeColor?: 'like' | 'accent';
  onPress: () => void;
  accessibilityLabel: string;
}) {
  const colors = useColors();
  // The engagement pair reads at the card body's own ink (the description
  // colour); any other action keeps the web's foreground-subtle. The heart is
  // the only one that turns pink when it lights up.
  const isEngagement = icon === 'heart' || icon === 'message-circle';
  const tint = active
    ? activeColor === 'like'
      ? colors.like
      : colors.accent
    : isEngagement
      ? colors.foreground
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
        <HeartIcon size={iconSize} active={Boolean(active)} color={colors.foreground} />
      ) : icon === 'message-circle' ? (
        <CommentGlyph size={iconSize} color={tint} />
      ) : (
        <Feather name={icon} size={iconSize} color={tint} />
      )}
      <Text style={[styles.actionText, { color: tint }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Web thread card: rounded-xl bg-background-subtle px-5 py-5 — a flat
  // surface with no outer outline rather than a shadowed card.
  card: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  likeBurst: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    // Above the photo grid it is drawn over.
    zIndex: 1,
  },
  cardBody: { padding: 20, gap: 12 },
  // The web resource card's link tile — same type scale and 144×96 image.
  previewTile: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
    borderRadius: 12,
    borderWidth: 1,
    padding: 16,
    overflow: 'hidden',
  },
  previewTileCopy: { flex: 1, minWidth: 0 },
  previewTileTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 12, lineHeight: 16 },
  previewTileDescription: {
    fontFamily: 'Geist_400Regular',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 4,
  },
  previewTileDomainRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  previewTileFavicon: { width: 14, height: 14, borderRadius: 2 },
  previewTileDomain: { flexShrink: 1, fontFamily: 'Geist_400Regular', fontSize: 11 },
  previewTileImage: { width: 144, height: 96, borderRadius: 8 },

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
  authorNamePress: { flexShrink: 1 },
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

  // Card body/description: 15px, 20px leading, medium — same on every kind.
  cardTitle: { fontFamily: 'Geist_500Medium', fontSize: 15, lineHeight: 20 },
  description: { fontFamily: 'Geist_500Medium', fontSize: 15, lineHeight: 20 },
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
  actionText: { fontFamily: 'Geist_500Medium', fontSize: 14 },

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
  videoPosterFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  videoThumb: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
  },
  videoMuteButton: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },

  detailRoot: { flex: 1 },
  flex: { flex: 1 },
  commentDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
    overflow: 'visible',
  },
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
  detailTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 25, lineHeight: 32 },
  // The detail body mirrors the feed card: one type scale for every content
  // kind, so a post does not change size when it opens.
  detailThreadBody: { fontFamily: 'Geist_500Medium', fontSize: 15, lineHeight: 20 },
  detailDescription: { fontFamily: 'Geist_500Medium', fontSize: 15, lineHeight: 20 },
});
