import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { hapticError, hapticSelection, hapticSuccess, hapticToggle } from '@/lib/haptics';
import {
  ALLOWED_COMMENT_REACTIONS,
  COMMENT_MAX_LENGTH,
  commentReactionsSupported,
  deleteComment,
  getComments,
  postComment,
  projectCommentReaction,
  sortComments,
  toggleCommentReaction,
  type CommentKind,
  type CommentReactionEmoji,
  type CommentSortOrder,
  type CommunityComment,
} from '@/lib/comments';
import { commentParticipantNames, splitCommentText } from '@/lib/commentText';
import { resolveProfilePictureUri } from '@/lib/profilePicture';

/**
 * The community comment section, ported from the web `CommentSection`.
 *
 * One modal serves every content type (threads, showcase, resources, events)
 * and mirrors the web design: a 36px circular avatar in a gutter with a
 * connector bracket dropping to a thread's replies, the author's name and
 * relative time on one line with a `···` options menu on the right, their
 * experience level under it, the body with `@mentions` painted blue, then one
 * flat muted action strip — emoji reaction picker, reaction chips, Reply.
 */

/** Matches the web `Avatar size="lg"`: one size for the whole thread. */
const AVATAR_SIZE = 36;

/** The sort control's two options, in the order the web `<select>` lists them. */
const SORT_OPTIONS: Array<{ value: CommentSortOrder; label: string }> = [
  { value: 'newest', label: 'Most recent' },
  { value: 'popular', label: 'Most popular' },
];

/** Which floating layer is open. Lifted here so only one can be open at a time
 *  and one tap anywhere else dismisses it. */
type OpenLayer =
  | { type: 'sort' }
  | { type: 'menu'; commentId: string }
  | { type: 'picker'; commentId: string }
  | null;

interface Props {
  visible: boolean;
  communityId: string;
  kind: CommentKind;
  /** The thread / post / resource / event the comments belong to. */
  targetId: string;
  currentUserId: string;
  title?: string;
  /** Posts may close replies (`allow_replies === false`). */
  allowReplies?: boolean;
  onClose: () => void;
  /** Reports the live comment total so the parent's counter stays correct. */
  onCountChange?: (total: number) => void;
}

function formatRelativeDate(value: string): string {
  const elapsed = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(elapsed / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function commentTotal(comments: CommunityComment[]): number {
  return comments.reduce((total, comment) => total + 1 + (comment.replies?.length ?? 0), 0);
}

/**
 * Seed text for the reply composer: mention the author we're replying to, the
 * way the web app does — unless it's our own comment.
 */
function replyMention(target: CommunityComment, currentUserId: string): string | undefined {
  const name = target.users?.name;
  if (!name || target.user_id === currentUserId) return undefined;
  return `@${name} `;
}

export function CommentsSheet({
  visible,
  communityId,
  kind,
  targetId,
  currentUserId,
  title,
  allowReplies = true,
  onClose,
  onCountChange,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<CommentSortOrder>('newest');
  const [replyTarget, setReplyTarget] = useState<CommunityComment | null>(null);
  const [layer, setLayer] = useState<OpenLayer>(null);

  const canReact = commentReactionsSupported(kind);
  const maxLength = COMMENT_MAX_LENGTH[kind];

  // Held in a ref so `load` stays stable: an inline parent callback would
  // otherwise re-create it on every render and re-fire the fetch effect below,
  // which loops as soon as the parent stores the count.
  const onCountChangeRef = useRef(onCountChange);
  useEffect(() => {
    onCountChangeRef.current = onCountChange;
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await getComments(communityId, kind, targetId);
      setComments(rows);
      onCountChangeRef.current?.(commentTotal(rows));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load comments.');
    } finally {
      setLoading(false);
    }
  }, [communityId, kind, targetId]);

  useEffect(() => {
    if (!visible) return;
    void load();
  }, [visible, load]);

  // A fresh modal starts with nothing expanded.
  useEffect(() => {
    if (!visible) setLayer(null);
  }, [visible]);

  const handlePosted = useCallback((comment: CommunityComment) => {
    setComments((previous) => {
      const next = comment.parent_id
        ? previous.map((entry) =>
            entry.id === comment.parent_id
              ? { ...entry, replies: [...(entry.replies ?? []), comment] }
              : entry,
          )
        : [...previous, { ...comment, replies: [] }];
      onCountChangeRef.current?.(commentTotal(next));
      return next;
    });
    setReplyTarget(null);
  }, []);

  const handleDeleted = useCallback((commentId: string, parentId: string | null) => {
    setComments((previous) => {
      const next = parentId
        ? previous.map((entry) =>
            entry.id === parentId
              ? { ...entry, replies: (entry.replies ?? []).filter((reply) => reply.id !== commentId) }
              : entry,
          )
        : previous.filter((entry) => entry.id !== commentId);
      onCountChangeRef.current?.(commentTotal(next));
      return next;
    });
    setLayer(null);
  }, []);

  /** Patches one comment's reactions, whichever level of the thread it lives on. */
  const handleReactionToggled = useCallback(
    (commentId: string, parentId: string | null, reactions: CommunityComment['reactions']) => {
      setComments((previous) => {
        const patch = (entry: CommunityComment): CommunityComment =>
          entry.id === commentId ? { ...entry, reactions } : entry;
        if (!parentId) return previous.map((entry) => (entry.id === commentId ? patch(entry) : entry));
        return previous.map((entry) =>
          entry.id === parentId
            ? { ...entry, replies: (entry.replies ?? []).map(patch) }
            : entry,
        );
      });
    },
    [],
  );

  // Applies to every level of the tree, so the control still does something on
  // a post whose comments all hang under one root.
  const sorted = useMemo(() => sortComments(comments, sort), [comments, sort]);

  // Author names in this thread, so reply mentions of them read as one blue tag
  // — including multi-word names.
  const mentionNames = useMemo(() => commentParticipantNames(comments), [comments]);

  const total = useMemo(() => commentTotal(comments), [comments]);
  const activeSortLabel =
    SORT_OPTIONS.find((option) => option.value === sort)?.label ?? 'Most recent';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            { paddingTop: insets.top + 10, borderBottomColor: colors.borderSubtle },
          ]}
        >
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Comments</Text>
          <View style={styles.headerCount}>
            <Feather name="message-square" size={14} color={colors.foregroundMuted} />
            <Text style={[styles.headerCountText, { color: colors.foregroundMuted }]}>{total}</Text>
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close comments"
            style={styles.headerClose}
          >
            <Feather name="x" size={22} color={colors.foreground} />
          </Pressable>
        </View>

        {title ? (
          <Text style={[styles.context, { color: colors.foregroundMuted }]} numberOfLines={1}>
            {title}
          </Text>
        ) : null}

        {/* Sort control: a select-style trigger on the left, in the comment
            column, matching the web toolbar. */}
        <View style={[styles.toolbar, { borderBottomColor: colors.borderSubtle }]}>
          <Pressable
            onPress={() => {
              hapticSelection();
              setLayer(layer?.type === 'sort' ? null : { type: 'sort' });
            }}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={`Sort comments, ${activeSortLabel}`}
            accessibilityState={{ expanded: layer?.type === 'sort' }}
            style={styles.sortTrigger}
          >
            {/* Feather has no single up/down sort glyph, so the web control's
                `ArrowUpDown` is drawn as its two halves. */}
            <View style={styles.sortGlyph}>
              <Feather name="arrow-up" size={12} color={colors.foreground} />
              <Feather name="arrow-down" size={12} color={colors.foreground} style={styles.sortGlyphHalf} />
            </View>
            <Text style={[styles.sortTriggerText, { color: colors.foreground }]}>
              {activeSortLabel}
            </Text>
            <Feather
              name={layer?.type === 'sort' ? 'chevron-up' : 'chevron-down'}
              size={12}
              color={colors.foreground}
            />
          </Pressable>

          {layer?.type === 'sort' ? (
            <View
              style={[
                styles.sortMenu,
                { backgroundColor: colors.overlayElevated, borderColor: colors.border },
              ]}
            >
              {SORT_OPTIONS.map((option) => {
                const active = option.value === sort;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => {
                      hapticSelection();
                      setSort(option.value);
                      setLayer(null);
                    }}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={styles.sortMenuItem}
                  >
                    <Text
                      style={[
                        styles.sortMenuItemText,
                        { color: active ? colors.accent : colors.foregroundMuted },
                      ]}
                    >
                      {option.label}
                    </Text>
                    {active ? <Feather name="check" size={13} color={colors.accent} /> : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>

        {/* One tap anywhere else dismisses the open menu, like clicking off a
            web popover. Rows and the toolbar sit above it. */}
        {layer ? (
          <Pressable
            style={styles.dismissLayer}
            onPress={() => setLayer(null)}
            accessibilityLabel="Dismiss menu"
          />
        ) : null}

        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top + 48}
        >
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : error ? (
            <View style={styles.center}>
              <Feather name="wifi-off" size={26} color={colors.foregroundMuted} />
              <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                Couldn&apos;t load comments
              </Text>
              <Text style={[styles.emptyBody, { color: colors.foregroundMuted }]}>{error}</Text>
              <Pressable onPress={load} accessibilityRole="button">
                <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
              </Pressable>
            </View>
          ) : (
            <FlatList
              data={sorted}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <CommentRow
                  comment={item}
                  communityId={communityId}
                  kind={kind}
                  targetId={targetId}
                  currentUserId={currentUserId}
                  allowReplies={allowReplies}
                  canReact={canReact}
                  mentionNames={mentionNames}
                  layer={layer}
                  onLayerChange={setLayer}
                  replyTarget={replyTarget}
                  onReplyTargetChange={setReplyTarget}
                  onDeleted={handleDeleted}
                  onReplied={handlePosted}
                  onReactionToggled={handleReactionToggled}
                />
              )}
              ListEmptyComponent={
                <View style={styles.center}>
                  <Feather name="message-circle" size={28} color={colors.foregroundSubtle} />
                  <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
                    No comments yet
                  </Text>
                  <Text style={[styles.emptyBody, { color: colors.foregroundMuted }]}>
                    Start the conversation — the first comment is the hardest.
                  </Text>
                </View>
              }
            />
          )}

          {allowReplies ? (
            <CommentComposer
              communityId={communityId}
              kind={kind}
              targetId={targetId}
              maxLength={maxLength}
              placeholder="Add comment"
              submitLabel="Send"
              onPosted={handlePosted}
              bottomInset={insets.bottom}
            />
          ) : (
            <View
              style={[
                styles.closed,
                { borderTopColor: colors.borderSubtle, paddingBottom: insets.bottom + 12 },
              ]}
            >
              <Text style={[styles.closedText, { color: colors.foregroundSubtle }]}>
                Replies are closed.
              </Text>
            </View>
          )}
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Composer
// ---------------------------------------------------------------------------

function CommentComposer({
  communityId,
  kind,
  targetId,
  parentId,
  initialBody,
  placeholder,
  submitLabel,
  maxLength,
  autoFocus,
  compact,
  onPosted,
  onCancel,
  bottomInset = 0,
}: {
  communityId: string;
  kind: CommentKind;
  targetId: string;
  parentId?: string;
  initialBody?: string;
  placeholder?: string;
  submitLabel: string;
  maxLength: number;
  autoFocus?: boolean;
  compact?: boolean;
  onPosted: (comment: CommunityComment) => void;
  onCancel?: () => void;
  bottomInset?: number;
}) {
  const colors = useColors();
  const [body, setBody] = useState(initialBody ?? '');
  const [sending, setSending] = useState(false);

  const trimmed = body.trim();
  const canSend = trimmed.length > 0 && trimmed.length <= maxLength && !sending;
  // The send pill only exists once there is something to send, like the web
  // field — an empty composer should read as a prompt, not a form. It stays
  // mounted while saving so the spinner has somewhere to live.
  const showSend = trimmed.length > 0 || sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const comment = await postComment(communityId, kind, targetId, {
        body: trimmed,
        parent_id: parentId ?? null,
      });
      setBody('');
      hapticSuccess();
      onPosted(comment);
    } catch (e) {
      hapticError();
      Alert.alert('Could not post', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <View
      style={[
        styles.composer,
        {
          backgroundColor: colors.background,
          borderTopColor: colors.borderSubtle,
          paddingBottom: bottomInset + 12,
        },
      ]}
    >
      <View style={[styles.composerField, { backgroundColor: colors.surfaceRaised }]}>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder={placeholder ?? 'Add comment'}
          placeholderTextColor={colors.foregroundSubtle}
          multiline
          autoFocus={autoFocus}
          maxLength={maxLength}
          style={[styles.composerInput, { color: colors.foreground }]}
        />
        {showSend ? (
          <Pressable
            onPress={send}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel={submitLabel}
            style={[
              styles.composerSend,
              { backgroundColor: canSend ? colors.accent : colors.accentSoft },
            ]}
          >
            {sending ? (
              <ActivityIndicator size="small" color={colors.accentForeground} />
            ) : (
              <Feather
                name="arrow-up"
                size={16}
                color={canSend ? colors.accentForeground : colors.foregroundSubtle}
              />
            )}
          </Pressable>
        ) : null}
      </View>
      {compact && onCancel ? (
        <Pressable
          onPress={() => {
            hapticSelection();
            onCancel();
          }}
          hitSlop={6}
          style={styles.composerCancel}
        >
          <Text style={[styles.composerCancelText, { color: colors.foregroundMuted }]}>Cancel</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Comment row (with one level of replies)
// ---------------------------------------------------------------------------

function CommentRow({
  comment,
  communityId,
  kind,
  targetId,
  currentUserId,
  allowReplies,
  canReact,
  mentionNames,
  isReply,
  layer,
  onLayerChange,
  replyTarget,
  onReplyTargetChange,
  onDeleted,
  onReplied,
  onReactionToggled,
}: {
  comment: CommunityComment;
  communityId: string;
  kind: CommentKind;
  targetId: string;
  currentUserId: string;
  allowReplies: boolean;
  canReact: boolean;
  mentionNames: readonly string[];
  isReply?: boolean;
  layer: OpenLayer;
  onLayerChange: (layer: OpenLayer) => void;
  replyTarget: CommunityComment | null;
  onReplyTargetChange: (target: CommunityComment | null) => void;
  onDeleted: (id: string, parentId: string | null) => void;
  onReplied: (comment: CommunityComment) => void;
  onReactionToggled: (
    commentId: string,
    parentId: string | null,
    reactions: CommunityComment['reactions'],
  ) => void;
}) {
  const colors = useColors();
  const [repliesOpen, setRepliesOpen] = useState(true);
  const [deleting, setDeleting] = useState(false);
  // Report is a signal, not a stored record — the option acknowledges the tap
  // ("Reported") for a moment, exactly like the web comment menu.
  const [reported, setReported] = useState(false);
  const reactPending = useRef(false);

  const menuOpen = layer?.type === 'menu' && layer.commentId === comment.id;
  const pickerOpen = layer?.type === 'picker' && layer.commentId === comment.id;

  const isOwner = comment.user_id === currentUserId;
  const name = comment.users?.name ?? 'Member';
  const designation = comment.users?.designation ?? null;
  const replies = comment.replies ?? [];
  const hasReplies = !isReply && replies.length > 0;
  const hostsReplyComposer = Boolean(
    !isReply && replyTarget && (replyTarget.id === comment.id || replyTarget.parent_id === comment.id),
  );
  // Top-level comments with a reply thread hang the connector bracket in the
  // avatar gutter, spanning the replies below them.
  const showConnector = !isReply && (hasReplies || hostsReplyComposer);
  // The blue the web comment menus use for a selected reaction / Reply, and the
  // wash behind it.
  const accentText = colors.isDark ? colors.chatMentionOwn : colors.chatMention;
  const accentWash = colors.isDark ? 'rgba(82, 168, 255, 0.14)' : 'rgba(0, 114, 245, 0.10)';
  const connectorColor = colors.isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.10)';
  const replyActive = replyTarget?.id === comment.id;
  const activeReplyTarget = hostsReplyComposer ? replyTarget : null;
  const avatarUri = resolveProfilePictureUri(comment.users?.avatar_url);
  const bodySegments = useMemo(
    () => splitCommentText(comment.body, mentionNames),
    [comment.body, mentionNames],
  );

  const confirmDelete = () => {
    onLayerChange(null);
    Alert.alert('Delete comment?', 'This will permanently remove this comment. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setDeleting(true);
          try {
            await deleteComment(communityId, kind, targetId, comment.id);
            hapticSuccess();
            onDeleted(comment.id, comment.parent_id);
          } catch (e) {
            hapticError();
            Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.');
          } finally {
            setDeleting(false);
          }
        },
      },
    ]);
  };

  const handleReport = () => {
    hapticSelection();
    onLayerChange(null);
    setReported(true);
    setTimeout(() => setReported(false), 3000);
  };

  const toggleReaction = async (emoji: CommentReactionEmoji) => {
    if (reactPending.current) return;
    const current = comment.reactions ?? [];
    // Tapping your own emoji removes it, anything else adds — tick by direction.
    hapticToggle(!(current.find((reaction) => reaction.emoji === emoji)?.reacted ?? false));
    reactPending.current = true;
    // Paint the flip immediately, then reconcile with the authoritative list.
    onReactionToggled(comment.id, comment.parent_id, projectCommentReaction(current, emoji));
    onLayerChange(null);
    try {
      const reactions = await toggleCommentReaction(communityId, kind, targetId, comment.id, emoji);
      onReactionToggled(comment.id, comment.parent_id, reactions);
    } catch {
      onReactionToggled(comment.id, comment.parent_id, current);
    } finally {
      reactPending.current = false;
    }
  };

  const startReply = () => {
    hapticSelection();
    onLayerChange(null);
    onReplyTargetChange(replyActive ? null : comment);
    setRepliesOpen(true);
  };

  return (
    <View style={[styles.row, menuOpen ? styles.rowRaised : null]}>
      {/* Avatar gutter: the circle pinned left, the thread's connector bracket
          dropping from under it and curving right under the last reply. */}
      <View style={styles.gutter}>
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.surfaceRaised }]}>
            <Text style={[styles.avatarText, { color: colors.foregroundMuted }]}>
              {name.slice(0, 1).toUpperCase()}
            </Text>
          </View>
        )}
        {showConnector ? (
          <View style={styles.connector}>
            <View style={[styles.connectorElbow, { borderColor: connectorColor }]} />
          </View>
        ) : null}
      </View>

      <View style={styles.content}>
        {/* One line tall so the name sits level with the top of the avatar. */}
        <View style={styles.nameRow}>
          <Text style={[styles.author, { color: colors.foreground }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.dot, { color: colors.foregroundSubtle }]}>•</Text>
          <Text style={[styles.time, { color: colors.foregroundMuted }]}>
            {formatRelativeDate(comment.created_at)}
          </Text>
          {/* Every comment carries the menu: Report is open to everyone, Delete
              only to the author. */}
          <Pressable
            onPress={() => {
              hapticSelection();
              onLayerChange(menuOpen ? null : { type: 'menu', commentId: comment.id });
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Comment options"
            accessibilityState={{ expanded: menuOpen }}
            style={styles.menuButton}
          >
            <Feather name="more-horizontal" size={16} color={colors.foregroundMuted} />
          </Pressable>

          {menuOpen ? (
            <View
              style={[
                styles.menuPanel,
                { backgroundColor: colors.overlayElevated, borderColor: colors.border },
              ]}
            >
              {isOwner ? (
                <Pressable
                  onPress={confirmDelete}
                  disabled={deleting}
                  accessibilityRole="button"
                  style={styles.menuItem}
                >
                  <Feather name="trash-2" size={12} color={colors.destructive} />
                  <Text style={[styles.menuItemText, { color: colors.destructive }]}>
                    {deleting ? 'Deleting…' : 'Delete'}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={handleReport}
                disabled={reported}
                accessibilityRole="button"
                style={styles.menuItem}
              >
                <Feather name="flag" size={12} color={colors.foregroundMuted} />
                <Text
                  style={[
                    styles.menuItemText,
                    { color: reported ? colors.foregroundSubtle : colors.foregroundMuted },
                  ]}
                >
                  {reported ? 'Reported' : 'Report'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* The author's experience level, tracking the name on its own line. */}
        {designation ? (
          <Text style={[styles.designation, { color: colors.foregroundMuted }]}>{designation}</Text>
        ) : null}

        <Text style={[styles.commentText, { color: colors.foreground }]}>
          {bodySegments.map((segment, index) =>
            segment.mention ? (
              <Text key={`m${index}`} style={[styles.mention, { color: accentText }]}>
                {segment.text}
              </Text>
            ) : (
              segment.text
            ),
          )}
        </Text>

        {comment.image_url ? (
          <Image source={{ uri: comment.image_url }} style={styles.commentImage} resizeMode="cover" />
        ) : null}

        <View style={[styles.actionRow, pickerOpen ? styles.actionRowRaised : null]}>
          {canReact ? (
            <>
              <Pressable
                onPress={() => {
                  hapticSelection();
                  onLayerChange(pickerOpen ? null : { type: 'picker', commentId: comment.id });
                }}
                style={[styles.actionButton, styles.actionEdge]}
                accessibilityRole="button"
                accessibilityLabel="Add reaction"
                accessibilityState={{ expanded: pickerOpen }}
              >
                <Feather
                  name="smile"
                  size={16}
                  color={pickerOpen ? accentText : colors.foregroundMuted}
                />
              </Pressable>

              {(comment.reactions ?? []).map((reaction) => (
                <Pressable
                  key={reaction.emoji}
                  onPress={() => toggleReaction(reaction.emoji as CommentReactionEmoji)}
                  style={[
                    styles.reactionChip,
                    { backgroundColor: reaction.reacted ? accentWash : 'transparent' },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: reaction.reacted }}
                  accessibilityLabel={`${reaction.emoji} ${reaction.count}`}
                >
                  <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
                  <Text
                    style={[
                      styles.reactionCount,
                      { color: reaction.reacted ? accentText : colors.foregroundMuted },
                    ]}
                  >
                    {reaction.count}
                  </Text>
                </Pressable>
              ))}
            </>
          ) : null}

          {allowReplies ? (
            <Pressable
              onPress={startReply}
              style={[
                styles.replyButton,
                { backgroundColor: replyActive ? accentWash : 'transparent' },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: replyActive }}
            >
              <Text
                style={[
                  styles.replyButtonText,
                  { color: replyActive ? accentText : colors.foregroundMuted },
                ]}
              >
                Reply
              </Text>
            </Pressable>
          ) : null}
        </View>

        {pickerOpen ? (
          <View
            style={[
              styles.picker,
              { backgroundColor: colors.overlayElevated, borderColor: colors.border },
            ]}
          >
            {ALLOWED_COMMENT_REACTIONS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => toggleReaction(emoji)}
                style={styles.pickerItem}
                accessibilityRole="button"
                accessibilityLabel={`React with ${emoji}`}
              >
                <Text style={styles.pickerEmoji}>{emoji}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        {!isReply && (hasReplies || hostsReplyComposer) ? (
          <View style={styles.replyBlock}>
            {hasReplies && repliesOpen ? (
              <View style={styles.replyList}>
                {replies.map((reply) => (
                  <CommentRow
                    key={reply.id}
                    comment={reply}
                    communityId={communityId}
                    kind={kind}
                    targetId={targetId}
                    currentUserId={currentUserId}
                    allowReplies={allowReplies}
                    canReact={canReact}
                    mentionNames={mentionNames}
                    isReply
                    layer={layer}
                    onLayerChange={onLayerChange}
                    replyTarget={replyTarget}
                    onReplyTargetChange={onReplyTargetChange}
                    onDeleted={onDeleted}
                    onReplied={onReplied}
                    onReactionToggled={onReactionToggled}
                  />
                ))}
              </View>
            ) : null}

            {hasReplies ? (
              <Pressable
                onPress={() => {
                  hapticSelection();
                  setRepliesOpen((open) => !open);
                }}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityState={{ expanded: repliesOpen }}
                style={styles.hideReplies}
              >
                <Text style={[styles.hideRepliesText, { color: colors.foreground }]}>
                  {repliesOpen
                    ? 'Hide replies'
                    : `View ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
                </Text>
                <Feather
                  name={repliesOpen ? 'chevron-up' : 'chevron-down'}
                  size={14}
                  color={colors.foreground}
                />
              </Pressable>
            ) : null}

            {activeReplyTarget ? (
              <View style={styles.replyComposer}>
                <CommentComposer
                  key={activeReplyTarget.id}
                  communityId={communityId}
                  kind={kind}
                  targetId={targetId}
                  // One level of nesting — replies always land on the top-level comment.
                  parentId={comment.id}
                  initialBody={replyMention(activeReplyTarget, currentUserId)}
                  maxLength={COMMENT_MAX_LENGTH[kind]}
                  // Same prompt as every other comment field — the seeded
                  // `@Name` already says who this reply is aimed at.
                  placeholder="Add comment"
                  submitLabel="Reply"
                  autoFocus
                  compact
                  onPosted={onReplied}
                  onCancel={() => onReplyTargetChange(null)}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { flex: 1, fontSize: 17, fontFamily: 'Geist_600SemiBold' },
  headerCount: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerCountText: { fontSize: 13, fontFamily: 'Geist_500Medium' },
  headerClose: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },

  context: { fontSize: 12, fontFamily: 'Geist_400Regular', paddingHorizontal: 16, paddingTop: 10 },

  // Left-aligned, like the web toolbar: the sort control sits in the comment
  // column rather than floating against the right edge.
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 20,
  },
  sortTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingRight: 2,
  },
  sortGlyph: { flexDirection: 'row', alignItems: 'center' },
  sortGlyphHalf: { marginLeft: -7 },
  sortTriggerText: { fontSize: 12, fontFamily: 'Geist_600SemiBold' },
  sortMenu: {
    position: 'absolute',
    top: '100%',
    left: 16,
    minWidth: 168,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
    zIndex: 30,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  sortMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sortMenuItemText: { fontSize: 13, fontFamily: 'Geist_500Medium' },

  dismissLayer: { ...StyleSheet.absoluteFillObject, zIndex: 20 },

  list: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 24, gap: 16, flexGrow: 1 },
  center: {
    flex: 1,
    minHeight: 220,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 28,
  },
  emptyTitle: { fontSize: 15, fontFamily: 'Geist_600SemiBold', marginTop: 4 },
  emptyBody: { fontSize: 13, fontFamily: 'Geist_400Regular', textAlign: 'center' },
  retry: { fontSize: 13, fontFamily: 'Geist_600SemiBold', marginTop: 4 },

  row: { flexDirection: 'row', gap: 12 },
  // Lift the row carrying an open menu above the rows below it.
  rowRaised: { zIndex: 30 },
  gutter: { width: AVATAR_SIZE, alignItems: 'center' },
  avatar: { width: AVATAR_SIZE, height: AVATAR_SIZE, borderRadius: AVATAR_SIZE / 2 },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontFamily: 'Geist_600SemiBold' },

  // The bracket drops from under the avatar and curves right under the last
  // reply: left border on the avatar's centre line, bottom border curving out
  // of it. Every width here is relative to the 16px wrapper, which is centred
  // in the 36px gutter — so the vertical line lands on the avatar's centre.
  connector: { marginTop: 4, alignSelf: 'stretch', flex: 1 },
  connectorElbow: {
    position: 'absolute',
    // 18 = half the avatar, so the vertical line runs through its centre; the
    // horizontal border reaches 34, two pixels short of the gutter's edge.
    left: AVATAR_SIZE / 2,
    right: 2,
    top: 0,
    bottom: 4,
    borderLeftWidth: 1,
    borderBottomWidth: 1,
    borderBottomLeftRadius: 16,
  },

  content: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 20 },
  author: { flexShrink: 1, fontSize: 14, fontFamily: 'Geist_600SemiBold' },
  dot: { fontSize: 12 },
  time: { fontSize: 11, fontFamily: 'Geist_400Regular' },
  menuButton: {
    marginLeft: 'auto',
    marginRight: -6,
    // Cancels the button's own overflow so the name row stays exactly one line
    // tall and the name lines up with the top of the avatar (web does the same
    // with a negative block margin).
    marginVertical: -4,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuPanel: {
    position: 'absolute',
    top: 30,
    right: 0,
    minWidth: 132,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 4,
    zIndex: 30,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  menuItemText: { fontSize: 12, fontFamily: 'Geist_400Regular' },

  designation: { fontSize: 12, fontFamily: 'Geist_400Regular', marginTop: 1 },
  commentText: { marginTop: 4, fontSize: 14, lineHeight: 20, fontFamily: 'Geist_400Regular' },
  mention: { fontFamily: 'Geist_500Medium' },
  commentImage: { marginTop: 8, width: '100%', height: 180, borderRadius: 12 },

  // One quiet strip: the emoji glyph, the chips and Reply all read muted, and
  // only the emoji button's own padding is cancelled so its glyph — not its hit
  // area — lines up with the comment text above.
  actionRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
  },
  actionRowRaised: { zIndex: 30 },
  actionEdge: { marginLeft: -8 },
  actionButton: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  reactionChip: {
    height: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 8,
    paddingHorizontal: 8,
  },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { fontSize: 12, fontFamily: 'Geist_500Medium', fontVariant: ['tabular-nums'] },
  replyButton: {
    height: 32,
    borderRadius: 8,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  replyButtonText: { fontSize: 12, fontFamily: 'Geist_600SemiBold' },

  picker: {
    marginTop: 8,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 4,
    zIndex: 30,
    elevation: 12,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  pickerItem: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  pickerEmoji: { fontSize: 20 },

  replyBlock: { marginTop: 12, gap: 12 },
  replyList: { gap: 12 },
  hideReplies: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hideRepliesText: { fontSize: 12, fontFamily: 'Geist_600SemiBold' },
  replyComposer: { marginTop: 2 },

  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 12,
    gap: 6,
  },
  composerField: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    // 40px tall and a true pill: the radius is past half the height, so the
    // ends are round without the field turning into a capsule as it grows.
    minHeight: 40,
    borderRadius: 20,
    paddingLeft: 14,
    paddingRight: 4,
    paddingVertical: 4,
  },
  composerInput: {
    flex: 1,
    minHeight: 32,
    maxHeight: 120,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Geist_400Regular',
    paddingTop: Platform.OS === 'ios' ? 6 : 4,
  },
  composerSend: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerCancel: { alignSelf: 'flex-end', paddingVertical: 2 },
  composerCancelText: { fontSize: 12, fontFamily: 'Geist_500Medium' },

  closed: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 16,
    alignItems: 'center',
  },
  closedText: { fontSize: 12, fontFamily: 'Geist_400Regular' },
});
