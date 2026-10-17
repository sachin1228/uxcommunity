import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView as RNKeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  KeyboardAvoidingView as KeyboardControllerAvoidingView,
  KeyboardEvents,
} from 'react-native-keyboard-controller';
import { useColors } from '@/hooks/useColors';
import { useChatMessages } from '@/hooks/useChatMessages';
import { useChatContentEvents } from '@/hooks/useChatContentEvents';
import { useTypingPresence } from '@/hooks/useTypingPresence';
import { useAuth } from '@/context/AuthContext';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { ContentNotificationCard } from '@/components/chat/ContentNotificationCard';
import { ContentActionsSheet } from '@/components/chat/ContentActionsSheet';
import { ImageViewer, LightboxImage } from '@/components/chat/ImageViewer';
import { ChatInput, PendingImage } from '@/components/chat/ChatInput';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { MessageActionsSheet } from '@/components/chat/MessageActionsSheet';
import { EditMessageModal } from '@/components/chat/EditMessageModal';
import { DisappearingNotice } from '@/components/chat/DisappearingNotice';
import { CommunityActionsSheet, type CommunityConfirmAction } from '@/components/community/CommunityActionsSheet';
import { CommunityMuteSheet } from '@/components/community/CommunityMuteSheet';
import { CommunityTabIcon } from '@/components/community/TabIcons';
import { CommunityNameBadges } from '@/components/communities/CommunityBadges';
import { DpWithEventDate } from '@/components/communities/DpWithEventDate';
import { useCommunityTabDots } from '@/hooks/useCommunityTabDots';
import { useOnlinePresence } from '@/hooks/useOnlinePresence';
import { ContentIcon } from '@/components/chat/ContentIcons';
import {
  archiveCommunity,
  leaveCommunity,
  setCommunityMute,
  setMessageReaction,
  setContentEventReaction,
  deleteMessage,
  getCommunities,
  getCommunityDetail,
  type Community,
  type CommunityMuteDuration,
  type Message,
} from '@/lib/communities';
import { isCommunityMuted } from '@/lib/communityMute';
import {
  fmtDate,
  myReactionEmoji,
  nextReactionIntent,
  projectOwnReaction,
  type MessageMention,
  type ReactionIntent,
} from '@/lib/chat';
import {
  mergeChatTimeline,
  replyDraftFromContent,
  tabForChatContentKind,
  type ChatContentEvent,
  type ReplyDraft,
} from '@/lib/chatContentEvents';
import { useSendMessage } from '@/hooks/useSendMessage';
import { hapticToggle } from '@/lib/haptics';
import { communityStore } from '@/lib/communityStore';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommunityContentView } from '@/components/community/CommunityContentView';
import { CommunityInfoView } from '@/components/community/CommunityInfoView';
import { isContentKind, type CommunityTab, type ContentKind } from '@/lib/communityContent';

/** FlatList row: a day divider, the unread marker, the retention notice, a message, or a "created a …" card. */
type ChatRow =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'unread'; key: string }
  | { kind: 'notice'; key: string }
  | { kind: 'message'; key: string; msg: Message; isSameAuthor: boolean }
  | { kind: 'content'; key: string; event: ChatContentEvent };

export default function CommunityChat() {
  const {
    id,
    name,
    image,
    tabs: enabledTabsParam,
    showcase: showcaseParam,
    owner: ownerParam,
    unread: unreadParam,
    read: readParam,
    members,
    contentKind,
    contentId,
  } = useLocalSearchParams<{
    id: string;
    name: string;
    image?: string;
    tabs?: string;
    showcase?: string;
    owner?: string;
    unread?: string;
    read?: string;
    members?: string;
    contentKind?: string;
    contentId?: string;
  }>();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [headerHeight, setHeaderHeight] = useState(0);
  const [activeTab, setActiveTab] = useState<CommunityTab>('chat');
  /** Inline emoji panel below the composer (WhatsApp-style) — closed when
   *  the chat scrolls, a tab changes, or the screen loses the composer. */
  const [emojiPanelOpen, setEmojiPanelOpen] = useState(false);
  /** The WhatsApp-style community info screen behind the header title. */
  const [infoOpen, setInfoOpen] = useState(false);
  /**
   * Every open resolves the community from the signed-in member's list — not
   * just push deep-links, where the route can only carry the id. The header's
   * bell menu, name badges and event tile read the live community object
   * (mute state, event dates), while the route params only carry the display
   * snapshot taken when the list row was tapped.
   */
  const [resolved, setResolved] = useState<Community | null>(null);
  /** Detail-route fallback for the header count when the list lacks the row. */
  const [detailMemberCount, setDetailMemberCount] = useState<number | null>(null);
  const [memberCountLoading, setMemberCountLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setMemberCountLoading(true);

    const fillCount = async (row: Community | null) => {
      if (cancelled || row?.member_count != null) return;
      try {
        const detail = await getCommunityDetail(id);
        if (!cancelled && detail?.member_count != null) {
          setDetailMemberCount(detail.member_count);
        }
      } catch {
        /* no count available — the line renders what it knows */
      }
    };

    getCommunities()
      .then(async (list) => {
        const row = list.find((c) => c.id === id) ?? null;
        if (!cancelled) setResolved(row);
        await fillCount(row);
      })
      .catch(async () => {
        /* deep links still get their counts from the detail route */
        await fillCount(null);
      })
      .finally(() => {
        if (!cancelled) setMemberCountLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const enabledTabs = new Set(
    (enabledTabsParam
      ? decodeURIComponent(enabledTabsParam).split(',')
      : resolved?.enabled_tabs ?? ['chat', 'threads', 'showcase', 'resources', 'events']
    ).map((tab) => tab.trim().toLowerCase()),
  );
  // Same order and labels as the web community header.
  const allTabs: Array<{ key: CommunityTab; label: string }> = [
    { key: 'chat', label: 'Chat' },
    { key: 'threads', label: 'Threads' },
    { key: 'showcase', label: 'Showcase' },
    { key: 'resources', label: 'Resources' },
    { key: 'events', label: 'Events' },
  ];
  /**
   * Showcase keeps its own flag and defaults to on (web `isShowcaseEnabled`),
   * so a community whose row predates the flag still shows the tab.
   */
  const showcaseEnabled = showcaseParam !== '0' && resolved?.showcase_enabled !== false;
  const tabs = allTabs.filter((tab) => {
    if (tab.key === 'chat') return true;
    if (tab.key === 'showcase') return showcaseEnabled;
    return enabledTabs.has(tab.key);
  });

  // Unread marker inputs, snapshotted before the list zeroes its badge.
  const initialUnreadCount = Number(unreadParam ?? resolved?.unread_count ?? 0) || 0;
  const lastReadAt = readParam
    ? decodeURIComponent(readParam)
    : resolved?.last_read_at ?? null;
  // Don't latch the unread position until we actually know it — on a push
  // deep-link the community (and therefore last_read_at) arrives a beat later.
  const readStateKnown = unreadParam !== undefined || resolved !== null;

  // "New since you last looked" dots for the nav (web parity — see the hook).
  // Anchor = the read watermark as of this open, snapshotted above before the
  // chat marks the community read.
  const { tabDots } = useCommunityTabDots({
    communityId: id,
    currentUserId: user?.id ?? '',
    activeTab,
    anchorAt: lastReadAt,
  });

  // The header's second line — "3 members • 1 online" (web ChatHeader parity).
  // The live row wins, the list's route snapshot paints instantly, and the
  // detail route fills deep links that were not opened from the list.
  const routeMemberCount = (() => {
    if (!members) return null;
    const parsed = Number(members);
    return Number.isFinite(parsed) ? parsed : null;
  })();
  const memberCount =
    resolved?.member_count ?? routeMemberCount ?? detailMemberCount;
  const { onlineCount } = useOnlinePresence({
    communityId: id,
    currentUserId: user?.id ?? '',
  });

  // Track this as the active community so useCommunities won't increment
  // unread_count for incoming messages while we're looking at this chat.
  useEffect(() => {
    communityStore.activeCommunityId = id;
    return () => {
      communityStore.activeCommunityId = null;
    };
  }, [id]);

  const {
    messages,
    setMessages,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadMore,
    updateReactions,
    softDeleteMessage,
  } = useChatMessages(id);

  // The chat timeline's permanent "created a …" cards (threads / showcase /
  // resources / events) — history window + realtime + local mirror.
  const {
    events: contentEvents,
    ready: contentEventsReady,
    applyContentReactions,
  } = useChatContentEvents(id);

  const { typingUsers, onInputChange, stopTyping } = useTypingPresence(id);

  /**
   * The composer's reply draft — a message or a "created a …" card (see
   * ReplyDraft). ReplyDraft.content_kind set means the card anchor.
   */
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  /** The "created a …" card a long-press opened the actions sheet for. */
  const [selectedContent, setSelectedContent] = useState<ChatContentEvent | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const [imageIndex, setImageIndex] = useState<number | null>(null);
  /**
   * An item a chat card asked to open — handed to its tab, which mounts with
   * it and opens the detail, then reports back so it is not re-opened on the
   * next mount.
   */
  const [openTarget, setOpenTarget] = useState<{ tab: CommunityTab; id: string } | null>(null);

  /**
   * A notification's link, walked in: the item it is about lives on its own
   * tab, so open that tab with it already selected — the same hand-off
   * handleContentOpen performs for a tapped "created a …" card. The route
   * parser (lib/notifications) has vetted the kind, but a hand-written deep
   * link has not, so it is checked again here.
   */
  useEffect(() => {
    if (!isContentKind(contentKind) || !contentId) return;
    setOpenTarget({ tab: contentKind, id: contentId });
    setActiveTab(contentKind);
  }, [contentKind, contentId]);

  /** The header bell's mute dropdown state. */
  const [muteSheetOpen, setMuteSheetOpen] = useState(false);
  const [muteBusy, setMuteBusy] = useState(false);
  /** The header ⋯ options (Delete chat / Exit community). */
  const [actionsSheetOpen, setActionsSheetOpen] = useState(false);

  /**
   * The screen's toast — Web-parity notices like "Chat muted" (with Undo),
   * "Chat unmuted" and the copy confirmation. One at a time; it dismisses
   * itself unless the action is taken first.
   */
  const [toast, setToast] = useState<{
    message: string;
    icon?: 'check';
    actionLabel?: string;
    onAction?: () => Promise<void> | void;
  } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissToast = useCallback(() => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = null;
    setToast(null);
  }, []);
  const showToast = useCallback(
    (next: NonNullable<typeof toast>) => {
      setToast(next);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => {
        toastTimer.current = null;
        setToast(null);
      }, 4000);
    },
    [],
  );
  useEffect(() => () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);

  // Timed mutes lapse on their own without the row being rewritten, so the
  // state is computed from the deadline against the clock, never from the
  // column's presence (see isCommunityMuted).
  const muted = isCommunityMuted(resolved);

  // The second line of the muted sheet: when the mute lapses, or that it
  // never does — the same label formatting as the web dropdown (region date,
  // fixed en-US 12-hour clock). Computed here but rendered only while the
  // sheet is open, so no render formats it before a click.
  const muteStateLabel = (() => {
    if (!muted) return null;
    if (resolved?.notifications_muted) return 'Muted';
    const until = resolved?.notifications_muted_until;
    if (!until) return null;
    const deadline = new Date(until);
    if (!Number.isFinite(deadline.getTime())) return null;
    const date = deadline.toLocaleDateString();
    const time = deadline.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    return `Muted until ${date} at ${time}`;
  })();

  /**
   * Save the caller's mute for this community and confirm with a toast —
   * "Chat muted" with an Undo that mutes back off, "Chat unmuted" as a plain
   * notice (web parity). Returns whether the save landed; `reportFailure` is
   * off for the undo path, where the toast's own failure handling owns it.
   */
  const applyMute = useCallback(
    async (
      duration: CommunityMuteDuration,
      { reportFailure = true }: { reportFailure?: boolean } = {},
    ): Promise<boolean> => {
      if (muteBusy) return false;
      setMuteBusy(true);
      try {
        const state = await setCommunityMute(id, duration);
        // Patch the screen's own copy and the list's row — the crossed bell
        // must be there the moment the user is back.
        setResolved((prev) => (prev ? { ...prev, ...state } : prev));
        communityStore.notifyCommunityChanged({ kind: 'patch', communityId: id, patch: state });
        if (duration === 'off') {
          showToast({ message: 'Chat unmuted' });
        } else {
          showToast({
            message: 'Chat muted',
            actionLabel: 'Undo',
            onAction: async () => {
              // A failed undo rejects so the failure path fires (web UndoToast).
              if (!(await applyMute('off', { reportFailure: false }))) {
                throw new Error('undo failed');
              }
            },
          });
        }
        setMuteSheetOpen(false);
        return true;
      } catch {
        if (reportFailure) {
          showToast({ message: "Couldn't update notifications. Try again." });
        }
        return false;
      } finally {
        setMuteBusy(false);
      }
    },
    // The undo closure references applyMute itself — the reference binds to
    // this instance at call time, exactly like the web handler's recursion.
    [id, muteBusy, showToast],
  );

  /**
   * "Delete chat" (archive, the caller's list only) and "Exit community"
   * (leave, the membership) — the web ⋯ menu's two actions, with the same
   * confirm copy. Rejects on failure so the sheet stays up; the toast says
   * what happened.
   */
  const handleCommunityAction = useCallback(
    async (action: CommunityConfirmAction) => {
      if (action === 'delete') {
        try {
          await archiveCommunity(id);
        } catch {
          showToast({ message: "Couldn't delete the chat. Try again." });
          throw new Error('archive failed');
        }
        // Archived rows are hidden from the list and reappear when a new
        // message arrives — the realtime handler un-archives them.
        communityStore.notifyCommunityChanged({
          kind: 'patch',
          communityId: id,
          patch: { is_archived: true },
        });
      } else {
        try {
          await leaveCommunity(id);
        } catch {
          showToast({ message: "Couldn't exit the community. Try again." });
          throw new Error('leave failed');
        }
        // The membership is gone; drop the row and free the active marker so
        // the list does not keep treating this community as open.
        communityStore.notifyCommunityChanged({ kind: 'remove', communityId: id });
        communityStore.activeCommunityId = null;
      }
      setActionsSheetOpen(false);
      // Back to the communities list, like the web dialog's push to the
      // dashboard (a deep-linked screen has no back stack — replace instead).
      if (router.canGoBack()) router.back();
      else router.replace('/communities');
    },
    [id, router, showToast],
  );

  const handleToastAction = useCallback(() => {
    const action = toast?.onAction;
    if (!action) return;
    dismissToast();
    Promise.resolve(action()).catch(() => {
      showToast({ message: "Couldn't undo that" });
    });
  }, [toast, dismissToast, showToast]);

  const ownerId = ownerParam ?? resolved?.owner_id;
  const isOwnCommunity = !!ownerId && !!user?.id && ownerId === user.id;

  const listRef = useRef<FlatList<ChatRow>>(null);

  /**
   * atBottom — whether the newest message is on screen. Updated by
   * onViewableItemsChanged, which is far more reliable than scroll-offset
   * arithmetic (no timing race, no threshold guessing). The ref feeds the
   * keyboard handler; the state drives the "jump to latest" button.
   */
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const lastMessageIdRef = useRef<string | null>(null);

  // ── Unread marker: latched once, from the first loaded page ──────────────
  const unreadLatchedRef = useRef(false);
  /** The first open waits for the unread latch before choosing its anchor. */
  const [initialPositionReady, setInitialPositionReady] = useState(false);
  /** The list stays hidden until the anchor scroll is committed (no top flash). */
  const [initialPositionResolved, setInitialPositionResolved] = useState(false);
  const initialScrollDoneRef = useRef(false);
  useEffect(() => {
    if (unreadLatchedRef.current || !readStateKnown || isLoading) return;
    unreadLatchedRef.current = true;
    setInitialPositionReady(true);
    if (messages.length === 0) return;
    if (!lastReadAt || initialUnreadCount <= 0) return;
    const firstUnread = messages.find(
      (m) => m.created_at > lastReadAt && m.user_id !== user?.id,
    );
    if (firstUnread) setFirstUnreadId(firstUnread.id);
  }, [messages, isLoading, lastReadAt, initialUnreadCount, user?.id, readStateKnown]);

  // Deep links whose community lookup never lands must not hold the list
  // hidden forever: after a short grace, anchor at the bottom as if read.
  useEffect(() => {
    if (unreadLatchedRef.current || readStateKnown || isLoading) return undefined;
    const timer = setTimeout(() => {
      if (unreadLatchedRef.current) return;
      unreadLatchedRef.current = true;
      setInitialPositionReady(true);
    }, 600);
    return () => clearTimeout(timer);
  }, [readStateKnown, isLoading]);

  // ── Rows: day dividers + unread marker interleaved with the timeline ─────
  // Messages and "created a …" cards merge into one ascending timeline (the
  // same merge the web MessageList builds), so a card sits among the messages
  // of its moment. A card also breaks the "same author" run — the message
  // after one starts a fresh bubble group, exactly like the web list.
  const rows = useMemo<ChatRow[]>(() => {
    const out: ChatRow[] = [];
    let currentDate: string | null = null;
    let prevAuthorId: string | null = null;
    let groupIndex = 0;
    let unreadPlaced = false;

    for (const item of mergeChatTimeline(messages, contentEvents)) {
      const day = fmtDate(item.created_at);
      if (day !== currentDate) {
        // While older history may still exist above, the first group's pill
        // would "float" upward on every prepend — the web app hides it until
        // the real start of history is known. Same rule here.
        const isFirstGroup = groupIndex === 0;
        if (!isFirstGroup || !hasMore) {
          out.push({ kind: 'date', key: `date-${day}-${out.length}`, label: day });
        }
        currentDate = day;
        prevAuthorId = null;
        groupIndex += 1;
      }

      if (item.kind === 'content') {
        prevAuthorId = null;
        out.push({ kind: 'content', key: `content-${item.event.id}`, event: item.event });
        continue;
      }

      const msg = item.message;
      if (!unreadPlaced && firstUnreadId && msg.id === firstUnreadId) {
        out.push({ kind: 'unread', key: `unread-${msg.id}` });
        unreadPlaced = true;
      }

      out.push({
        kind: 'message',
        key: msg.id,
        msg,
        isSameAuthor: prevAuthorId === msg.user_id,
      });
      prevAuthorId = msg.user_id;
    }

    // The disappearing-messages notice opens the history, above the first
    // date pill — only once the true start of it is loaded, so a notice
    // rendered while older pages may still exist cannot float down with every
    // prepend (web MessageList parity).
    if (!hasMore && out.length > 0) {
      out.unshift({ kind: 'notice', key: 'notice' });
    }
    return out;
  }, [messages, contentEvents, hasMore, firstUnreadId]);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    lastMessageIdRef.current = lastMessage?.id ?? null;
  }, [messages]);

  // ── Initial position: the unread divider when one exists, newest otherwise
  // (the web's useScrollAndUnread anchor). One-shot: later messages never
  // re-position the reader.
  useEffect(() => {
    if (error) return;
    if (!initialPositionReady || isLoading || !contentEventsReady) return;
    if (initialScrollDoneRef.current) return;
    initialScrollDoneRef.current = true;

    if (rows.length === 0) {
      setInitialPositionResolved(true);
      return;
    }

    requestAnimationFrame(() => {
      if (firstUnreadId) {
        const index = rows.findIndex((row) => row.kind === 'unread');
        if (index >= 0) {
          listRef.current?.scrollToIndex({
            index,
            animated: false,
            viewPosition: 0.15,
          });
        } else {
          listRef.current?.scrollToEnd({ animated: false });
        }
      } else {
        listRef.current?.scrollToEnd({ animated: false });
      }
      // One more frame lets the native scroll commit before the list paints.
      requestAnimationFrame(() => setInitialPositionResolved(true));
    });
  }, [
    initialPositionReady,
    isLoading,
    contentEventsReady,
    firstUnreadId,
    rows,
    error,
  ]);

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 10 });
  const handleViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: ChatRow }> }) => {
      const lastId = lastMessageIdRef.current;
      if (!lastId) return;
      const next = viewableItems.some(
        (vi) => vi.item.kind === 'message' && vi.item.msg.id === lastId,
      );
      atBottomRef.current = next;
      // Only re-render when the answer actually flips.
      setAtBottom((prev) => (prev === next ? prev : next));
    },
  );

  const scrollToLatest = useCallback((animated = true) => {
    listRef.current?.scrollToEnd({ animated });
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = KeyboardEvents.addListener('keyboardDidShow', () => {
      // Only jump to the bottom when the last message is already visible.
      // If the user has scrolled up to read old messages, leave them there.
      if (atBottomRef.current) scrollToLatest(true);
    });

    return () => subscription.remove();
  }, [scrollToLatest]);

  const {
    handleSend: _handleSend,
    handleCancel,
    handleRetry,
    handleEdit,
    editSaving,
    editError,
    clearEditError,
  } = useSendMessage({
    communityId: id,
    currentUser: {
      id: user?.id ?? '',
      name: user?.name ?? 'You',
      avatar_url: user?.avatar_url ?? null,
    },
    setMessages,
    scrollToLatest,
    stopTyping,
  });

  const handleSend = useCallback(
    (text: string, pendingImage?: PendingImage, mentions?: MessageMention[]) => {
      _handleSend(text, pendingImage, replyTo, mentions);
      setReplyTo(null);
    },
    [_handleSend, replyTo],
  );

  /**
   * Message reactions.
   *
   * The API stores an explicit desired emoji (`null` clears it), so tapping
   * your own reaction removes it, any other tap replaces it — the same rule as
   * the web client. Painting the intent locally first keeps the tap instant,
   * and the server's grouped reactions are the final word once they land.
   *
   * The desired state is tracked in a ref as well as on screen: two taps in the
   * same tick both read a stale message otherwise, and the second would repeat
   * the first intent instead of undoing it.
   */
  const reactionIntentRef = useRef(new Map<string, ReactionIntent>());

  const handleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      const currentUser = user?.id ?? '';
      const message = messages.find((m) => m.id === messageId);
      if (!message || !currentUser) return;

      const previousReactions = message.reactions ?? [];
      const previous =
        reactionIntentRef.current.get(messageId) ??
        myReactionEmoji(previousReactions, currentUser);
      const desired = nextReactionIntent(previous, emoji);
      // Reacting and un-reacting are different gestures to the hand: the tick
      // fires here so the pill on the bubble and the tile in the action sheet
      // feel identical.
      hapticToggle(desired !== null);

      reactionIntentRef.current.set(messageId, desired);
      updateReactions(messageId, projectOwnReaction(previousReactions, desired, currentUser));

      try {
        const { reactions } = await setMessageReaction(id, messageId, desired);
        updateReactions(messageId, reactions);
        reactionIntentRef.current.set(messageId, myReactionEmoji(reactions, currentUser));
      } catch {
        // Roll the pill back rather than leave an intent the server rejected.
        reactionIntentRef.current.delete(messageId);
        updateReactions(messageId, previousReactions);
      }
    },
    [id, updateReactions, messages, user?.id],
  );

  const handleDelete = useCallback(
    async (messageId: string) => {
      // Optimistic soft-delete locally first
      softDeleteMessage(messageId);
      try {
        await deleteMessage(id, messageId);
      } catch {
        // Realtime UPDATE will reconcile if this fails
      }
    },
    [id, softDeleteMessage],
  );

  const handleCopy = useCallback(() => {
    showToast({ message: 'Copied', icon: 'check' });
  }, [showToast]);

  const handleSaveEdit = useCallback(
    async (messageId: string, content: string) => {
      const ok = await handleEdit(messageId, content);
      if (ok) setEditingMessage(null);
    },
    [handleEdit],
  );

  const handleLongPress = useCallback((msg: Message) => {
    setSelectedMessage(msg);
  }, []);

  /**
   * Long-press on a "created a …" card — the touch equivalent of the web
   * card's hover actions (reaction picker + reply).
   */
  const handleContentLongPress = useCallback((event: ChatContentEvent) => {
    setSelectedContent(event);
  }, []);

  /**
   * The sheet's Reply row: seed the composer with the card as the anchor —
   * the web handleContentReply contract (headline first line, kind-labeled
   * chip in the composer).
   */
  const handleContentReply = useCallback((event: ChatContentEvent) => {
    setReplyTo(replyDraftFromContent(event));
  }, []);

  /**
   * The sheet's Reply row for a message: the composer draft keys off the flat
   * fields (web handleReply parity — image-only messages quote "📷 Image").
   */
  const handleMessageReply = useCallback((msg: Message) => {
    setReplyTo({
      id: msg.id,
      content: msg.content || (msg.image_url ? '📷 Image' : ''),
      user_name: msg.users?.name ?? 'Unknown',
      user_id: msg.user_id,
    });
  }, []);

  /** Jumps the list to the message a reply quotes (web parity). */
  const handleReplyPress = useCallback(
    (messageId: string) => {
      const index = rows.findIndex((row) => row.kind === 'message' && row.msg.id === messageId);
      if (index < 0) return;
      try {
        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
      } catch {
        listRef.current?.scrollToOffset({ offset: Math.max(0, index * 60), animated: true });
      }
    },
    [rows],
  );

  /** Jumps the list to the "created a …" card a reply quotes (web parity). */
  const handleContentChipPress = useCallback(
    (contentId: string) => {
      const index = rows.findIndex(
        (row) => row.kind === 'content' && row.event.id === contentId,
      );
      if (index < 0) return;
      try {
        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
      } catch {
        listRef.current?.scrollToOffset({ offset: Math.max(0, index * 60), animated: true });
      }
    },
    [rows],
  );

  /**
   * A "created a …" card was tapped: its item lives on its own tab, so switch
   * there and hand the id over — CommunityContentView opens the detail once
   * its page has loaded (the mobile equivalent of the web card's link).
   */
  const handleContentOpen = useCallback((event: ChatContentEvent) => {
    setEmojiPanelOpen(false);
    const tab = tabForChatContentKind(event.kind);
    setOpenTarget({ tab, id: event.id });
    setActiveTab(tab);
  }, []);

  /**
   * Card reactions — the same desired-state flow as message reactions: the
   * tap paints instantly, the server's grouped reactions are the final word,
   * and a failure rolls the pills back. The desired state is tracked in a ref
   * as well as on screen so two taps in the same tick read each other.
   */
  const contentReactionIntentRef = useRef(new Map<string, ReactionIntent>());

  const handleContentReaction = useCallback(
    async (event: ChatContentEvent, emoji: string) => {
      const currentUser = user?.id ?? '';
      if (!currentUser) return;

      const previousReactions = event.reactions ?? [];
      const previous =
        contentReactionIntentRef.current.get(event.id) ??
        myReactionEmoji(previousReactions, currentUser);
      const desired = nextReactionIntent(previous, emoji);
      hapticToggle(desired !== null);

      contentReactionIntentRef.current.set(event.id, desired);
      applyContentReactions(
        event.id,
        event.kind,
        projectOwnReaction(previousReactions, desired, currentUser),
      );

      try {
        const { reactions } = await setContentEventReaction(id, event.id, event.kind, desired);
        applyContentReactions(event.id, event.kind, reactions);
        contentReactionIntentRef.current.set(event.id, myReactionEmoji(reactions, currentUser));
      } catch {
        contentReactionIntentRef.current.delete(event.id);
        applyContentReactions(event.id, event.kind, previousReactions);
      }
    },
    [id, applyContentReactions, user?.id],
  );

  // ── Lightbox: every image in the loaded timeline ─────────────────────────
  const lightboxImages = useMemo<LightboxImage[]>(
    () =>
      messages
        .filter((m) => !!m.image_url && !m.deleted_at)
        .map((m) => ({
          url: m.image_url as string,
          content: m.content,
          user_name: m.users?.name ?? null,
          avatar_url: m.users?.avatar_url ?? null,
          created_at: m.created_at,
        })),
    [messages],
  );

  const handleImagePress = useCallback(
    (url: string) => {
      const index = lightboxImages.findIndex((img) => img.url === url);
      setImageIndex(index < 0 ? 0 : index);
    },
    [lightboxImages],
  );

  const renderItem = useCallback(
    ({ item }: { item: ChatRow }) => {
      if (item.kind === 'date') {
        return (
          <View style={styles.dateDivider}>
            <Text
              style={[
                styles.datePill,
                { color: colors.mutedForeground, backgroundColor: colors.surfaceRaised },
              ]}
            >
              {item.label}
            </Text>
          </View>
        );
      }

      if (item.kind === 'unread') {
        const label =
          initialUnreadCount > 0
            ? `${initialUnreadCount} unread message${initialUnreadCount === 1 ? '' : 's'}`
            : 'New messages';
        return (
          <View style={styles.unreadDivider}>
            <View style={[styles.unreadLine, { backgroundColor: colors.border }]} />
            <Text
              style={[
                styles.unreadPill,
                {
                  color: colors.mutedForeground,
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.border,
                },
              ]}
            >
              {label}
            </Text>
            <View style={[styles.unreadLine, { backgroundColor: colors.border }]} />
          </View>
        );
      }

      if (item.kind === 'notice') {
        return <DisappearingNotice />;
      }

      if (item.kind === 'content') {
        return (
          <ContentNotificationCard
            event={item.event}
            isOwn={item.event.user_id === user?.id}
            currentUserId={user?.id ?? ''}
            onOpen={handleContentOpen}
            onLongPress={handleContentLongPress}
            onReaction={handleContentReaction}
          />
        );
      }

      return (
        <MessageBubble
          message={item.msg}
          isOwn={item.msg.user_id === user?.id}
          isSameAuthor={item.isSameAuthor}
          currentUserId={user?.id ?? ''}
          onLongPress={handleLongPress}
          onReactionPress={handleReaction}
          onImagePress={handleImagePress}
          onCancel={handleCancel}
          onRetry={handleRetry}
          onReplyPress={handleReplyPress}
          onContentReplyPress={handleContentChipPress}
        />
      );
    },
    [
      user?.id,
      handleLongPress,
      handleReaction,
      handleImagePress,
      handleCancel,
      handleRetry,
      handleReplyPress,
      handleContentChipPress,
      handleContentOpen,
      handleContentLongPress,
      handleContentReaction,
      colors,
      initialUnreadCount,
    ],
  );

  const keyExtractor = useCallback((item: ChatRow) => item.key, []);

  const handleLoadMore = useCallback(() => {
    if (hasMore && !isLoadingMore) loadMore();
  }, [hasMore, isLoadingMore, loadMore]);

  const communityName = name ? decodeURIComponent(name) : resolved?.name ?? 'Community';
  const communityImage = image
    ? decodeURIComponent(image)
    : resolved?.image_url ?? null;

  const chatContent = (
    <View style={styles.flex}>
      {toast && (
        <View style={[styles.toast, { backgroundColor: colors.foreground }]}>
          {toast.icon === 'check' && (
            <Feather name="check" size={13} color={colors.background} />
          )}
          <Text style={[styles.toastText, { color: colors.background }]}>{toast.message}</Text>
          {toast.actionLabel && (
            <Pressable onPress={handleToastAction} hitSlop={8} accessibilityRole="button" accessibilityLabel={toast.actionLabel}>
              <Text style={[styles.toastAction, { color: colors.background }]}>
                {toast.actionLabel}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {isLoading && (
        <View style={styles.center}>
          {/* The UI accent, like every other loading state in the app — the
              own-bubble blue reads at ~3.5:1 against the chat background in the
              dark theme, a third of what the accent gets. */}
          <ActivityIndicator color={colors.accent} />
        </View>
      )}

      {!isLoading && error && (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
        </View>
      )}

      {!isLoading && (
        <FlatList
          ref={listRef}
          data={rows}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          style={{ opacity: initialPositionResolved ? 1 : 0 }}
          contentContainerStyle={[styles.messagesList, { paddingBottom: 8 }]}
          // Reading old messages means the user is done picking emoji —
          // close the inline panel so it doesn't eat half the screen.
          onScrollBeginDrag={() => setEmojiPanelOpen(false)}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onViewableItemsChanged={handleViewableItemsChanged.current}
          viewabilityConfig={viewabilityConfig.current}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.2}
          onScrollToIndexFailed={(info) => {
            // Variable-height bubbles make an exact index jump unreliable; land
            // near the row, let layout settle, then retry once.
            listRef.current?.scrollToOffset({
              offset: Math.max(0, info.averageItemLength * info.index),
              animated: true,
            });
            setTimeout(() => {
              try {
                listRef.current?.scrollToIndex({
                  index: info.index,
                  animated: true,
                  viewPosition: 0.5,
                });
              } catch {
                /* give up quietly — the user can scroll */
              }
            }, 120);
          }}
          ListHeaderComponent={
            isLoadingMore ? (
              <View style={styles.loadMoreSpinner}>
                <ActivityIndicator size="small" color={colors.accent} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            // The welcome copy waits for the content-event history too, so a
            // community whose only activity is a thread or a showcase post
            // never flashes "Be the first to say something" while the cards
            // are still in flight (web MessageList parity).
            contentEventsReady ? (
              <View style={styles.emptyWrap}>
                <DisappearingNotice />
                {communityImage ? (
                  <Image source={{ uri: communityImage }} style={styles.emptyAvatar} />
                ) : (
                  <View style={[styles.emptyAvatar, { backgroundColor: colors.surfaceRaised }]} />
                )}
                <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                  Welcome to{' '}
                  <Text style={{ color: colors.foreground, fontFamily: 'Geist_500Medium' }}>
                    {communityName}
                  </Text>
                  !
                  {'\n'}
                  <Text style={styles.emptySubtext}>Be the first to say something.</Text>
                </Text>
              </View>
            ) : null
          }
        />
      )}

      <View
        style={styles.footer}
        onLayout={() => {
          if (atBottomRef.current) scrollToLatest(false);
        }}
      >
        {/* Scroll-to-bottom button — floats just above the footer edge */}
        {!atBottom && !isLoading && (
          <Pressable
            onPress={() => scrollToLatest(true)}
            accessibilityLabel="Scroll to latest message"
            hitSlop={6}
            style={[
              styles.jumpBtn,
              { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
            ]}
          >
            <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
          </Pressable>
        )}

        <TypingIndicator users={typingUsers} />

        <ChatInput
          communityId={id}
          currentUserId={user?.id ?? ''}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={handleSend}
          onTypingChange={onInputChange}
          emojiPanelOpen={emojiPanelOpen}
          onEmojiPanelOpenChange={setEmojiPanelOpen}
        />
      </View>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />

      {/* Header measured for iOS keyboard offset. Android uses keyboard-controller height resize. */}
      <View
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
        style={[
          styles.header,
          {
            backgroundColor: colors.background,
            paddingTop: insets.top + 8,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </Pressable>

        {/* Tapping the title area opens the community info screen, like
            WhatsApp's contact info (web parity: the right sidebar there). */}
        <Pressable
          onPress={() => setInfoOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`${communityName} info`}
          style={styles.headerCenter}
        >
          {/* An event's group chat wears its date here too — and says LIVE
              while the event is under way (web header parity). */}
          <DpWithEventDate
            date={resolved?.event_date}
            endsAt={resolved?.event_end ?? resolved?.pinned_until}
            dpSize={40}
          >
            {communityImage ? (
              <Image
                source={{ uri: communityImage }}
                style={[styles.headerAvatar, { borderColor: colors.border }]}
              />
            ) : (
              <View
                style={[
                  styles.headerAvatar,
                  styles.headerAvatarFallback,
                  { backgroundColor: colors.surfaceRaised },
                ]}
              >
                <Text style={[styles.headerAvatarText, { color: colors.mutedForeground }]}>
                  {communityName.slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
          </DpWithEventDate>
          <View style={styles.headerTitles}>
            <View style={styles.headerTitleRow}>
              <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
                {communityName}
              </Text>
              <CommunityNameBadges
                type={resolved?.type}
                isPrivate={resolved?.is_private}
                size={12}
              />
            </View>
            {/* The web header's second line — how many members the room has,
                and (once anyone is connected) how many are online now. The
                count paints from the list snapshot first; a skeleton holds
                the line while a deep link resolves it, so it never snaps in
                a beat after the header. */}
            <View style={styles.headerMetaRow}>
              {memberCount !== null ? (
                <View style={styles.headerMetaItem}>
                  <ContentIcon name="users" size={10} color={colors.mutedForeground} />
                  <Text style={[styles.headerMetaText, { color: colors.mutedForeground }]}>
                    {memberCount} member{memberCount === 1 ? '' : 's'}
                  </Text>
                </View>
              ) : memberCountLoading ? (
                // The line holds its place while the count resolves, instead
                // of snapping into existence a beat after the header paints.
                <View
                  accessibilityLabel="Loading member count"
                  style={[
                    styles.headerMetaSkeleton,
                    { backgroundColor: colors.surfaceRaised },
                  ]}
                />
              ) : null}
              {onlineCount > 0 && (
                <View
                  style={styles.headerMetaItem}
                  accessible
                  accessibilityLabel={`${onlineCount} online`}
                >
                  <View style={styles.onlineDot} />
                  <Text style={[styles.headerMetaText, { color: colors.mutedForeground }]}>
                    {onlineCount} online
                  </Text>
                </View>
              )}
            </View>
          </View>
        </Pressable>

        {/* Notifications — its own control beside the ⋯ button rather than an
            item inside it, like the web header: plain bell while notifications
            are on, crossed bell while muted; the sheet carries the durations /
            the off switch. */}
        <Pressable
          onPress={() => setMuteSheetOpen(true)}
          disabled={muteBusy}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={muted ? 'Unmute notifications' : 'Mute notifications'}
          style={({ pressed }) => [
            styles.headerIconBtn,
            {
              backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
              opacity: muteBusy ? 0.5 : 1,
            },
          ]}
        >
          <Feather
            name={muted ? 'bell-off' : 'bell'}
            size={18}
            strokeWidth={2.5}
            color={colors.mutedForeground}
          />
        </Pressable>

        {/* Community options — Delete chat / Exit community. */}
        <Pressable
          onPress={() => setActionsSheetOpen(true)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Community options"
          style={({ pressed }) => [
            styles.headerIconBtn,
            { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
          ]}
        >
          <Feather
            name="more-horizontal"
            size={18}
            strokeWidth={2.5}
            color={colors.mutedForeground}
          />
        </Pressable>
      </View>

      <View
        style={[
          styles.tabsShell,
          { backgroundColor: colors.background, borderBottomColor: colors.border },
        ]}
      >
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {tabs.map((tab) => {
            const active = activeTab === tab.key;
            const labelColor = active ? colors.foreground : colors.mutedForeground;
            const showDot = tab.key !== 'chat' && !!tabDots[tab.key];
            return (
              <Pressable
                key={tab.key}
                onPress={() => {
                  setEmojiPanelOpen(false);
                  setActiveTab(tab.key);
                }}
                style={[
                  styles.tab,
                  // The active underline wears the UI accent, like the web
                  // header — white in the dark theme, near-black in light.
                  { borderBottomColor: active ? colors.accent : 'transparent' },
                ]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <View style={styles.tabInner}>
                  <CommunityTabIcon tab={tab.key} size={14} color={labelColor} />
                  <Text style={[styles.tabText, { color: labelColor }]}>{tab.label}</Text>
                  {/* The dot slot is always laid out — only its visibility
                      toggles — so clearing a dot (opening the tab) never
                      shifts the label or the tabs beside it (web parity). */}
                  <View
                    accessible={showDot}
                    accessibilityLabel={showDot ? 'New' : undefined}
                    style={[styles.tabDot, !showDot && styles.tabDotHidden]}
                  />
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {activeTab === 'chat' ? (
        <>
          {Platform.OS === 'android' ? (
            <KeyboardControllerAvoidingView style={styles.flex} behavior="height">
              {chatContent}
            </KeyboardControllerAvoidingView>
          ) : (
            <RNKeyboardAvoidingView
              style={styles.flex}
              behavior="padding"
              keyboardVerticalOffset={headerHeight}
            >
              {chatContent}
            </RNKeyboardAvoidingView>
          )}
          <View style={{ height: insets.bottom, backgroundColor: colors.background }} />
        </>
      ) : (
        <CommunityContentView
          communityId={id}
          kind={activeTab as ContentKind}
          currentUserId={user?.id ?? ''}
          openContentId={openTarget && openTarget.tab === activeTab ? openTarget.id : null}
          onOpenConsumed={() => setOpenTarget(null)}
        />
      )}

      {/* Full-screen image lightbox — mounted only while open */}
      {imageIndex !== null && lightboxImages.length > 0 && (
        <ImageViewer
          images={lightboxImages}
          index={Math.min(imageIndex, lightboxImages.length - 1)}
          onClose={() => setImageIndex(null)}
          onNavigate={setImageIndex}
        />
      )}

      {/* Long-press action sheet — reactions, reply, copy, edit, delete */}
      <MessageActionsSheet
        message={selectedMessage}
        currentUserId={user?.id ?? ''}
        canModerate={isOwnCommunity}
        onClose={() => setSelectedMessage(null)}
        onReact={handleReaction}
        onReply={handleMessageReply}
        onCopy={handleCopy}
        onEdit={(msg) => {
          clearEditError();
          setEditingMessage(msg);
        }}
        onDelete={handleDelete}
      />

      {/* Long-press action sheet for a "created a …" card — reactions + reply
          (the touch form of the web card's hover actions) */}
      <ContentActionsSheet
        event={selectedContent}
        currentUserId={user?.id ?? ''}
        onClose={() => setSelectedContent(null)}
        onReact={handleContentReaction}
        onReply={handleContentReply}
      />

      {/* Community info — WhatsApp-style, opened from the header title (the
          web right sidebar's content: members, about, rules) */}
      <CommunityInfoView
        visible={infoOpen}
        community={resolved}
        onlineCount={onlineCount}
        onClose={() => setInfoOpen(false)}
      />

      {/* Edit composer */}
      <EditMessageModal
        message={editingMessage}
        isSaving={editSaving}
        error={editError}
        onClose={() => {
          clearEditError();
          setEditingMessage(null);
        }}
        onSave={handleSaveEdit}
      />

      {/* Header bell menu — mute durations / unmute */}
      <CommunityMuteSheet
        open={muteSheetOpen}
        muted={muted}
        muteStateLabel={muteStateLabel}
        busy={muteBusy}
        onChoose={(duration) => {
          void applyMute(duration);
        }}
        onClose={() => {
          if (!muteBusy) setMuteSheetOpen(false);
        }}
      />

      {/* Header ⋯ menu — Delete chat / Exit community */}
      <CommunityActionsSheet
        open={actionsSheetOpen}
        onClose={() => setActionsSheetOpen(false)}
        onConfirm={handleCommunityAction}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 8,
    minWidth: 0,
  },
  tabsShell: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  tabs: {
    minWidth: '100%',
    paddingHorizontal: 12,
  },
  tab: {
    minWidth: 82,
    height: 48,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tabText: {
    fontSize: 12,
    fontFamily: 'Geist_500Medium',
  },
  tabDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    // The web dot's red-500, kept literal like the calendar tile's inks.
    backgroundColor: '#EF4444',
  },
  tabDotHidden: {
    opacity: 0,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  headerAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarText: {
    fontSize: 16,
    fontFamily: 'Geist_600SemiBold',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flexShrink: 1,
    minWidth: 0,
  },
  headerTitles: { flexShrink: 1, minWidth: 0 },
  headerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  headerMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerMetaText: { fontSize: 11, fontFamily: 'Geist_400Regular' },
  headerMetaSkeleton: {
    width: 76,
    height: 10,
    borderRadius: 5,
    opacity: 0.7,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    // The web dot's green-500, kept literal like the tab dot's red-500.
    backgroundColor: '#22C55E',
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: 'Geist_600SemiBold',
    flexShrink: 1,
  },
  headerIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  errorText: {
    fontSize: 14,
    fontFamily: 'Geist_400Regular',
    textAlign: 'center',
  },
  loadMoreSpinner: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  messagesList: {
    flexGrow: 1,
    paddingTop: 4,
  },
  dateDivider: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  datePill: {
    fontSize: 11,
    fontFamily: 'Geist_500Medium',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 3,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  unreadDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginVertical: 12,
  },
  unreadLine: { flex: 1, height: StyleSheet.hairlineWidth },
  unreadPill: {
    fontSize: 11,
    fontFamily: 'Geist_500Medium',
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 32,
  },
  emptyAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Geist_400Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
  emptySubtext: { fontSize: 12 },
  footer: { position: 'relative' },
  jumpBtn: {
    position: 'absolute',
    right: 16,
    top: -40,
    zIndex: 20,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  toast: {
    position: 'absolute',
    alignSelf: 'center',
    top: 12,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  toastText: { fontSize: 12, fontFamily: 'Geist_500Medium' },
  toastAction: {
    fontSize: 12,
    fontFamily: 'Geist_700Bold',
    textDecorationLine: 'underline',
    marginLeft: 2,
  },
});
