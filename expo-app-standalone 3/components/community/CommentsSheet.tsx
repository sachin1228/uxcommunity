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
import {
  ALLOWED_COMMENT_REACTIONS,
  COMMENT_MAX_LENGTH,
  commentReactionsSupported,
  deleteComment,
  getComments,
  postComment,
  projectCommentReaction,
  toggleCommentReaction,
  totalCommentReactions,
  type CommentKind,
  type CommentReactionEmoji,
  type CommunityComment,
} from '@/lib/comments';
import { resolveProfilePictureUri } from '@/lib/profilePicture';

/**
 * The community comment section, ported from the web `CommentSection`.
 *
 * One modal serves every content type (threads, showcase, resources, events):
 * a composer, a count + sort toolbar, then a timeline of comments with one
 * level of replies, emoji reactions (threads only — the only kind the API
 * supports), and delete for your own comments.
 */

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

type SortOrder = 'newest' | 'popular';

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
  const [sort, setSort] = useState<SortOrder>('newest');
  const [replyTarget, setReplyTarget] = useState<CommunityComment | null>(null);

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

  const sorted = useMemo(() => {
    const list = [...comments];
    list.sort((a, b) =>
      sort === 'popular'
        ? totalCommentReactions(b) - totalCommentReactions(a) ||
          Date.parse(b.created_at) - Date.parse(a.created_at)
        : Date.parse(b.created_at) - Date.parse(a.created_at),
    );
    return list;
  }, [comments, sort]);

  const total = useMemo(() => commentTotal(comments), [comments]);

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

        <View style={[styles.toolbar, { borderBottomColor: colors.borderSubtle }]}>
          <Text style={[styles.toolbarLabel, { color: colors.foregroundMuted }]}>
            {total} {total === 1 ? 'comment' : 'comments'}
          </Text>
          <View style={styles.sortGroup}>
            {(['newest', 'popular'] as SortOrder[]).map((option) => {
              const active = sort === option;
              return (
                <Pressable
                  key={option}
                  onPress={() => setSort(option)}
                  style={[
                    styles.sortChip,
                    {
                      backgroundColor: active ? colors.accentSoft : 'transparent',
                      borderColor: active ? colors.borderStrong : 'transparent',
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    style={[
                      styles.sortChipText,
                      { color: active ? colors.foreground : colors.foregroundMuted },
                    ]}
                  >
                    {option === 'newest' ? 'Most recent' : 'Most popular'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

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
              contentContainerStyle={[styles.list, { paddingBottom: 24 }]}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item, index }) => (
                <CommentRow
                  comment={item}
                  communityId={communityId}
                  kind={kind}
                  targetId={targetId}
                  currentUserId={currentUserId}
                  allowReplies={allowReplies}
                  canReact={canReact}
                  isLast={index === sorted.length - 1}
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
              placeholder="Add a comment…"
              submitLabel="Send"
              onPosted={handlePosted}
              bottomInset={insets.bottom}
            />
          ) : (
            <View style={[styles.closed, { borderTopColor: colors.borderSubtle, paddingBottom: insets.bottom + 12 }]}>
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

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const comment = await postComment(communityId, kind, targetId, {
        body: trimmed,
        parent_id: parentId ?? null,
      });
      setBody('');
      onPosted(comment);
    } catch (e) {
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
      <View
        style={[
          styles.composerField,
          { backgroundColor: colors.surfaceRaised, shadowColor: '#000' },
        ]}
      >
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder={placeholder ?? 'Add a comment…'}
          placeholderTextColor={colors.foregroundSubtle}
          multiline
          autoFocus={autoFocus}
          maxLength={maxLength}
          style={[styles.composerInput, { color: colors.foreground }]}
        />
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
              size={17}
              color={canSend ? colors.accentForeground : colors.foregroundSubtle}
            />
          )}
        </Pressable>
      </View>
      {compact && onCancel ? (
        <Pressable onPress={onCancel} hitSlop={6} style={styles.composerCancel}>
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
  isReply,
  isLast,
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
  isReply?: boolean;
  isLast?: boolean;
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reacting, setReacting] = useState(false);
  const reactPending = useRef(false);

  const isOwner = comment.user_id === currentUserId;
  const name = comment.users?.name ?? 'Member';
  const replies = comment.replies ?? [];
  const hasReplies = !isReply && replies.length > 0;
  const hostsReplyComposer = Boolean(
    !isReply && replyTarget && (replyTarget.id === comment.id || replyTarget.parent_id === comment.id),
  );

  const confirmDelete = () => {
    Alert.alert('Delete comment?', 'This will permanently remove this comment. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteComment(communityId, kind, targetId, comment.id);
            onDeleted(comment.id, comment.parent_id);
          } catch (e) {
            Alert.alert('Could not delete', e instanceof Error ? e.message : 'Please try again.');
          }
        },
      },
    ]);
  };

  const toggleReaction = async (emoji: CommentReactionEmoji) => {
    if (reactPending.current) return;
    const current = comment.reactions ?? [];
    reactPending.current = true;
    setReacting(true);
    // Paint the flip immediately, then reconcile with the authoritative list.
    onReactionToggled(comment.id, comment.parent_id, projectCommentReaction(current, emoji));
    setPickerOpen(false);
    try {
      const reactions = await toggleCommentReaction(communityId, kind, targetId, comment.id, emoji);
      onReactionToggled(comment.id, comment.parent_id, reactions);
    } catch {
      onReactionToggled(comment.id, comment.parent_id, current);
    } finally {
      reactPending.current = false;
      setReacting(false);
    }
  };

  const avatarUri = resolveProfilePictureUri(comment.users?.avatar_url);
  const activeReplyTarget = hostsReplyComposer ? replyTarget : null;

  return (
    <View style={[styles.timelineRow, !isReply && styles.timelineRowTop]}>
      {!isReply ? (
        <>
          <View style={[styles.timelineDot, { backgroundColor: colors.foregroundMuted }]} />
          <View
            style={[
              styles.timelineLine,
              { backgroundColor: colors.borderSubtle, bottom: hasReplies || !isLast ? -18 : 6 },
            ]}
          />
        </>
      ) : null}

      <View style={[styles.commentBody, isReply && styles.replyBody]}>
        <View style={styles.commentHeader}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarFallback, { backgroundColor: colors.surfaceRaised }]}>
              <Text style={[styles.avatarText, { color: colors.foregroundMuted }]}>
                {name.slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={[styles.author, { color: colors.foreground }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.dot, { color: colors.foregroundSubtle }]}>•</Text>
          <Text style={[styles.time, { color: colors.foregroundMuted }]}>
            {formatRelativeDate(comment.created_at)}
          </Text>
          {isOwner ? (
            <Pressable
              onPress={confirmDelete}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Delete comment"
              style={styles.deleteButton}
            >
              <Feather name="trash-2" size={14} color={colors.foregroundMuted} />
            </Pressable>
          ) : null}
        </View>

        <Text style={[styles.commentText, { color: colors.foreground }]}>{comment.body}</Text>

        {comment.image_url ? (
          <Image source={{ uri: comment.image_url }} style={styles.commentImage} resizeMode="cover" />
        ) : null}

        <View style={styles.reactionRow}>
          {canReact ? (
            <>
              <Pressable
                onPress={() => setPickerOpen((open) => !open)}
                style={[styles.addReaction, { backgroundColor: colors.surfaceRaised }]}
                accessibilityRole="button"
                accessibilityLabel="Add reaction"
                accessibilityState={{ expanded: pickerOpen }}
              >
                <Feather name="smile" size={13} color={colors.foregroundMuted} />
                <Feather name="plus" size={11} color={colors.foregroundMuted} />
              </Pressable>

              {(comment.reactions ?? []).map((reaction) => (
                <Pressable
                  key={reaction.emoji}
                  disabled={reacting}
                  onPress={() => toggleReaction(reaction.emoji as CommentReactionEmoji)}
                  style={[
                    styles.reactionPill,
                    {
                      backgroundColor: reaction.reacted ? colors.chatOwnBubble : colors.surfaceRaised,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: reaction.reacted }}
                  accessibilityLabel={`${reaction.emoji} ${reaction.count}`}
                >
                  <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
                  <Text
                    style={[
                      styles.reactionCount,
                      { color: reaction.reacted ? '#FFFFFF' : colors.foregroundMuted },
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
              onPress={() => {
                onReplyTargetChange(replyTarget?.id === comment.id ? null : comment);
                setRepliesOpen(true);
              }}
              style={[
                styles.replyButton,
                {
                  backgroundColor:
                    replyTarget?.id === comment.id ? colors.accentSoft : colors.surfaceRaised,
                },
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: replyTarget?.id === comment.id }}
            >
              <Text style={[styles.replyButtonText, { color: colors.foreground }]}>Reply</Text>
            </Pressable>
          ) : null}
        </View>

        {pickerOpen ? (
          <View style={[styles.picker, { backgroundColor: colors.overlayElevated, shadowColor: '#000' }]}>
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
            {hasReplies && repliesOpen
              ? replies.map((reply) => (
                  <CommentRow
                    key={reply.id}
                    comment={reply}
                    communityId={communityId}
                    kind={kind}
                    targetId={targetId}
                    currentUserId={currentUserId}
                    allowReplies={allowReplies}
                    canReact={canReact}
                    isReply
                    replyTarget={replyTarget}
                    onReplyTargetChange={onReplyTargetChange}
                    onDeleted={onDeleted}
                    onReplied={onReplied}
                    onReactionToggled={onReactionToggled}
                  />
                ))
              : null}

            {hasReplies ? (
              <Pressable onPress={() => setRepliesOpen((open) => !open)} hitSlop={6}>
                <Text style={[styles.collapseText, { color: colors.foreground }]}>
                  {repliesOpen
                    ? 'Collapse replies'
                    : `View ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
                </Text>
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
                  placeholder="Write a reply…"
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

  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolbarLabel: { fontSize: 12, fontFamily: 'Geist_500Medium' },
  sortGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sortChip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  sortChipText: { fontSize: 12, fontFamily: 'Geist_500Medium' },

  list: { paddingHorizontal: 16, paddingTop: 16, gap: 18, flexGrow: 1 },
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

  timelineRow: { position: 'relative' },
  timelineRowTop: { paddingLeft: 22 },
  timelineDot: { position: 'absolute', left: 6, top: 8, width: 6, height: 6, borderRadius: 3 },
  timelineLine: { position: 'absolute', left: 9.5, top: 16, width: StyleSheet.hairlineWidth },

  commentBody: { flexShrink: 1 },
  replyBody: { paddingLeft: 0 },
  commentHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 26, height: 26, borderRadius: 13, overflow: 'hidden' },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 11, fontFamily: 'Geist_600SemiBold' },
  author: { flexShrink: 1, fontSize: 13, fontFamily: 'Geist_600SemiBold' },
  dot: { fontSize: 11 },
  time: { fontSize: 11, fontFamily: 'Geist_400Regular' },
  deleteButton: { marginLeft: 'auto', paddingHorizontal: 4, paddingVertical: 4 },

  commentText: {
    marginTop: 6,
    fontSize: 14,
    lineHeight: 21,
    fontFamily: 'Geist_400Regular',
  },
  commentImage: { marginTop: 8, width: '100%', height: 180, borderRadius: 12 },

  reactionRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  addReaction: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: 999,
    paddingHorizontal: 10,
  },
  reactionPill: {
    height: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
  },
  reactionEmoji: { fontSize: 13 },
  reactionCount: { fontSize: 12, fontFamily: 'Geist_500Medium', fontVariant: ['tabular-nums'] },
  replyButton: { height: 30, borderRadius: 999, paddingHorizontal: 14, justifyContent: 'center' },
  replyButtonText: { fontSize: 12, fontFamily: 'Geist_500Medium' },

  picker: {
    marginTop: 8,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: 12,
    padding: 4,
    elevation: 6,
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  pickerItem: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  pickerEmoji: { fontSize: 19 },

  replyBlock: { marginTop: 12, paddingLeft: 22, gap: 12 },
  collapseText: { fontSize: 12, fontFamily: 'Geist_600SemiBold' },
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
    borderRadius: 18,
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 6,
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  composerInput: {
    flex: 1,
    minHeight: 34,
    maxHeight: 120,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Geist_400Regular',
    paddingTop: Platform.OS === 'ios' ? 8 : 4,
  },
  composerSend: {
    width: 34,
    height: 34,
    borderRadius: 17,
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
