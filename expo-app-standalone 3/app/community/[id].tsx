import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIsFocused } from '@react-navigation/native';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import Animated from 'react-native-reanimated';
import { useColors } from '@/hooks/useColors';
import { CHAT_LIST_PERFORMANCE } from '@/lib/homeFeed';
import { useChatMessages } from '@/hooks/useChatMessages';
import { useChatContentEvents } from '@/hooks/useChatContentEvents';
import { useTypingPresence } from '@/hooks/useTypingPresence';
import { useAuth } from '@/context/AuthContext';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { ContentNotificationCard } from '@/components/chat/ContentNotificationCard';
import { ContentActionsSheet } from '@/components/chat/ContentActionsSheet';
import { ImageViewer, LightboxImage } from '@/components/chat/ImageViewer';
import { ChatInput, ChatComposerHandle, PendingImage } from '@/components/chat/ChatInput';
import { EmojiPicker } from '@/components/chat/EmojiPicker';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { MessageActionsSheet } from '@/components/chat/MessageActionsSheet';
import { EditMessageModal } from '@/components/chat/EditMessageModal';
import { DisappearingNotice } from '@/components/chat/DisappearingNotice';
import { CommunityMenu, type CommunityConfirmAction } from '@/components/community/CommunityMenu';
import { CommunityMuteSheet } from '@/components/community/CommunityMuteSheet';
import { CommunityTabIcon } from '@/components/community/TabIcons';
import { CommunityNameBadges, VerifiedDpBadge } from '@/components/communities/CommunityBadges';
import { CommunityIcon } from '@/components/communities/CommunityIcon';
import { DpWithEventDate } from '@/components/communities/DpWithEventDate';
import { useCommunityTabDots } from '@/hooks/useCommunityTabDots';
import { useOnlinePresence } from '@/hooks/useOnlinePresence';
import {
  archiveCommunity,
  leaveCommunity,
  setCommunityMute,
  setMessageReaction,
  setContentEventReaction,
  deleteMessage,
  getCommunities,
  peekCommunitiesSnapshot,
  type Community,
  type CommunityDetailRow,
  type CommunityMuteDuration,
  type Message,
} from '@/lib/communities';
import { isCommunityMuted } from '@/lib/communityMute';
import { communityNameBadges } from '@/lib/communityBadges';
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
import { hapticSelection, hapticToggle } from '@/lib/haptics';
import { communityStore, type CommunityRowPatch } from '@/lib/communityStore';
import { setActiveCommunityForNotifications } from '@/lib/chatNotificationState';
import { loadCommunityDetail } from '@/lib/communityDetailCache';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useChatImeLayout } from '@/hooks/useChatImeLayout';
import { useScreenTransitionSettled } from '@/hooks/useScreenTransitionSettled';
import { CommunityContentView } from '@/components/community/CommunityContentView';
import { ContentDetailOverlay } from '@/components/community/ContentDetailOverlay';
import { CommunityInfoView } from '@/components/community/CommunityInfoView';
import { isContentKind, type CommunityTab, type ContentKind } from '@/lib/communityContent';
import { canModerateContent } from '@/lib/communityPermissions';

/** FlatList row: a day divider, the unread marker, the retention notice, a message, or a "created a …" card. */
type ChatRow =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'unread'; key: string }
  | { kind: 'notice'; key: string }
  | { kind: 'message'; key: string; msg: Message; isSameAuthor: boolean }
  | { kind: 'content'; key: string; event: ChatContentEvent };

/**
 * Web parity (useScrollAndUnread): being within this many pixels of the newest
 * row counts as "at the bottom" — for the inverted list, the scroll offset
 * itself. The jump pill appears beyond it, and a send landing anywhere inside
 * it never lights the pill.
 */
const JUMP_PILL_THRESHOLD = 80;
const COMMUNITY_CHAT_COMPOSER_BOTTOM_INSET = 6;

export default function CommunityChat() {
  const {
    id,
    name,
    image,
    type: typeParam,
    private: privateParam,
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
    type?: string;
    private?: string;
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
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<CommunityTab>('chat');
  const imeLayout = useChatImeLayout(activeTab === 'chat' && isFocused, {
    bottom: COMMUNITY_CHAT_COMPOSER_BOTTOM_INSET,
  });
  /**
   * The message list waits for the push animation to finish. Its first rows —
   * and the cached window behind them — are the most expensive thing this
   * screen mounts, and creating them while the native slide runs is what made
   * the open stutter (see hooks/useScreenTransitionSettled).
   */
  const listSettled = useScreenTransitionSettled();
  /** The WhatsApp-style community info screen behind the header title. */
  const [infoOpen, setInfoOpen] = useState(false);
  /**
   * Every open resolves the community from the signed-in member's list — not
   * just push deep-links, where the route can only carry the id. The header's
   * ⋯ menu, name badges and event tile read the live community object
   * (mute state, event dates), while the route params only carry the display
   * snapshot taken when the list row was tapped.
   */
  const [resolved, setResolved] = useState<Community | null>(
    () => peekCommunitiesSnapshot()?.find((row) => row.id === id) ?? null,
  );
  /**
   * The signed-in member's role and grants — the server read model's copy,
   * which the ⋯ menu reads to decide whether settings and management actions
   * are theirs. The list row only knows the owner id.
   */
  const [detail, setDetail] = useState<CommunityDetailRow | null>(null);
  /**
   * Settings saved on the pushed screen patch the list through the store; the
   * same patch lands here so the header repaints without a refetch (and the
   * route params, taken when the row was tapped, stop being authoritative).
   */
  const [livePatch, setLivePatch] = useState<CommunityRowPatch>({});
  /** Detail-route fallback for the header count when the list lacks the row. */
  const [detailMemberCount, setDetailMemberCount] = useState<number | null>(null);
  const [memberCountLoading, setMemberCountLoading] = useState(true);
  /** Row focus flash after a reply jump — cleared by its own timer. */
  const [flashMessageId, setFlashMessageId] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setMemberCountLoading(true);

    const fillCount = async (row: Community | null) => {
      if (cancelled || row?.member_count != null) return;
      try {
        const detail = await loadCommunityDetail(id);
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

  // Role + grants for the ⋯ menu's settings row and the info screen's
  // management actions. Shares the one read with the info screen and the
  // count fallback above (see lib/communityDetailCache).
  useEffect(() => {
    let cancelled = false;
    loadCommunityDetail(id)
      .then((row) => {
        if (!cancelled) setDetail(row);
      })
      .catch(() => {
        /* no role available — the screen keeps its read-only menus */
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Settings saved on the pushed screen patch the list through the store;
  // the header listens to the same channel so it repaints in the same frame.
  useEffect(
    () =>
      communityStore.subscribeCommunityChanges((change) => {
        if (change.kind !== 'patch' || change.communityId !== id) return;
        setLivePatch((prev) => ({ ...prev, ...change.patch }));
      }),
    [id],
  );

  const enabledTabs = new Set(
    (livePatch.enabled_tabs ??
      (enabledTabsParam
        ? decodeURIComponent(enabledTabsParam).split(',')
        : resolved?.enabled_tabs ?? ['chat', 'threads', 'showcase', 'resources', 'events'])
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
  const showcaseEnabled =
    livePatch.showcase_enabled !== undefined
      ? livePatch.showcase_enabled !== false
      : showcaseParam !== '0' && resolved?.showcase_enabled !== false;
  const tabs = allTabs.filter((tab) => {
    if (tab.key === 'chat') return true;
    if (tab.key === 'showcase') return showcaseEnabled;
    return enabledTabs.has(tab.key);
  });
  // A settings save can disable the tab the reader is on — fall back to Chat,
  // exactly like the web chat's renderedTab guard.
  const tabsKey = tabs.map((tab) => tab.key).join(',');
  useEffect(() => {
    if (!allTabs.some((tab) => tab.key === activeTab)) return;
    if (tabs.some((tab) => tab.key === activeTab)) return;
    setActiveTab('chat');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabsKey, activeTab]);

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
  // The native copy lets the Android FCM service skip this chat's notification
  // while custom-rendering every other one.
  useEffect(() => {
    communityStore.activeCommunityId = id;
    setActiveCommunityForNotifications(id);
    return () => {
      communityStore.activeCommunityId = null;
      setActiveCommunityForNotifications(null);
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

  // Handler-stable mirrors of the timeline. Reaction and reply handlers read
  // these instead of closing over `messages`/`rows`, so a new page or a
  // reaction no longer changes the callbacks and re-renders every mounted
  // bubble through `renderItem`.
  const messagesRef = useRef<Message[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
   * A chat card's post, opened over the chat itself. Kept apart from
   * `openTarget`: that hand-off exists to *switch* to a tab, which is exactly
   * what tapping a card in the chat should not do.
   */
  const [chatDetail, setChatDetail] = useState<{ kind: ContentKind; id: string } | null>(null);

  /**
   * A notification's link, walked in: the item it is about lives on its own
   * tab, so open that tab with it already selected. (A "created a …" card in
   * the chat does not come through here — it opens the page over the chat.)
   * The route parser (lib/notifications) has vetted the kind, but a
   * hand-written deep link has not, so it is checked again here.
   */
  useEffect(() => {
    if (!isContentKind(contentKind) || !contentId) return;
    setOpenTarget({ tab: contentKind, id: contentId });
    setActiveTab(contentKind);
  }, [contentKind, contentId]);

  /** The mute duration save in flight. */
  const [muteBusy, setMuteBusy] = useState(false);
  /** The ⋯ menu's mute row opens these durations in a sheet. */
  const [muteSheetOpen, setMuteSheetOpen] = useState(false);
  /** The header ⋯ menu — notifications, Delete chat, Exit community. */
  const [menuOpen, setMenuOpen] = useState(false);
  /** Bottom of the chat header, in the screen root's own coordinates. */
  const [headerHeight, setHeaderHeight] = useState(0);

  /**
   * The name line: verified/lock badges ride after the name only while the
   * whole title still fits. A long name takes the line alone and ellipsizes —
   * the badges would otherwise sit stranded after the ellipsis and eat space
   * the name needs. Measured once the header lays out: the intrinsic name
   * width (hidden single-line copy) against the header center's width.
   */
  const [headerCenterWidth, setHeaderCenterWidth] = useState<number | null>(null);
  const [nameWidth, setNameWidth] = useState<number | null>(null);
  const [badgesWidth, setBadgesWidth] = useState<number | null>(null);
  const showNameBadges =
    headerCenterWidth === null || nameWidth === null || badgesWidth === null
      ? true
      : // 48 = the 40px avatar + 8px gap before the title block;
        // 5 = headerTitleRow's gap.
        nameWidth + 5 + badgesWidth <= headerCenterWidth - 48;

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

  const ownerId = detail?.owner_id ?? resolved?.owner_id ?? ownerParam;
  const isOwnCommunity = !!ownerId && !!user?.id && ownerId === user.id;
  // The web chat's manager capabilities: owners hold everything, while a
  // platform-appointed admin or an in-app moderator holds their grants. An
  // admin appoints moderators (the manager tier); a moderator never does.
  const myRole = detail?.current_user_role ?? (isOwnCommunity ? 'owner' : null);
  const myPermissions = detail?.current_user_permissions;
  const isGranted = (key: 'can_edit_settings' | 'can_manage_members' | 'can_delete_messages') =>
    (myRole === 'admin' || myRole === 'moderator') && Boolean(myPermissions?.[key]);
  const canOpenSettings = isOwnCommunity || isGranted('can_edit_settings');
  const canManageMembers = isOwnCommunity || isGranted('can_manage_members');
  const canManageModerators = isOwnCommunity || myRole === 'admin';
  const canModerateMessages = isOwnCommunity || isGranted('can_delete_messages');
  /** Content tabs' manager gate — owners moderate everything, managers their grants. */
  const canModerateTab = (kind: ContentKind) =>
    canModerateContent(kind, myRole, myPermissions);

  const listRef = useRef<FlatList<ChatRow>>(null);
  const chatComposerRef = useRef<ChatComposerHandle>(null);

  /**
   * Inverted list (DM thread parity): data[0] is the newest row and native
   * offset 0 is the visual bottom, so a newly appended row lands at the
   * composer's edge the moment it is laid out — scrollToEnd measured the old
   * content, so the first jump stopped short and the optimistic bubble
   * settled below the fold. scrollToOffset(0) has no such race: its target is
   * absolute, not dependent on a row that has not been measured yet.
   *
   * atBottom — whether the reader is within JUMP_PILL_THRESHOLD px of the
   * newest row — for the inverted list, that distance *is* the offset. Web
   * parity: useScrollAndUnread flips the pill on distance from the bottom
   * (> 80px), not on "is the last row visible". Viewability flipped false for
   * the whole duration of every send's animated scroll — the pill flashed
   * above the composer on each message sent — and stayed there whenever the
   * newest bubble settled a few px below the fold. A distance threshold
   * cannot flicker mid-flight.
   */
  const atBottomRef = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  /** Once the initial anchor is committed, content changes may steer the list. */
  const initialPositionResolvedRef = useRef(false);
  /** The last message id seen — tells an append apart from edits/retention. */
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
  // The list's cell renderer only skips a re-render when the row object keeps
  // its identity. Rebuilding every row on each message or page would therefore
  // re-render every mounted bubble; reuse the previous object when the message
  // and its group flag are unchanged.
  const rowCacheRef = useRef(new Map<string, ChatRow>());

  const rows = useMemo<ChatRow[]>(() => {
    const out: ChatRow[] = [];
    const previousRows = rowCacheRef.current;
    const nextRows = new Map<string, ChatRow>();
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
        const key = `content-${item.event.id}`;
        const cached = previousRows.get(key);
        const row: ChatRow =
          cached && cached.kind === 'content' && cached.event === item.event
            ? cached
            : { kind: 'content', key, event: item.event };
        nextRows.set(key, row);
        out.push(row);
        continue;
      }

      const msg = item.message;
      if (!unreadPlaced && firstUnreadId && msg.id === firstUnreadId) {
        out.push({ kind: 'unread', key: `unread-${msg.id}` });
        unreadPlaced = true;
      }

      const isSameAuthor = prevAuthorId === msg.user_id;
      const cached = previousRows.get(msg.id);
      const row: ChatRow =
        cached && cached.kind === 'message' && cached.msg === msg && cached.isSameAuthor === isSameAuthor
          ? cached
          : { kind: 'message', key: msg.id, msg, isSameAuthor };
      nextRows.set(msg.id, row);
      out.push(row);
      prevAuthorId = msg.user_id;
    }

    // The disappearing-messages notice opens the history, above the first
    // date pill — only once the true start of it is loaded, so a notice
    // rendered while older pages may still exist cannot float down with every
    // prepend (web MessageList parity).
    if (!hasMore && out.length > 0) {
      out.unshift({ kind: 'notice', key: 'notice' });
    }
    rowCacheRef.current = nextRows;
    // The list is inverted; newest must sit at the bottom. Offset 0 is the
    // visual bottom, so an appended row lands at the composer's edge the
    // moment it is laid out — no scrollToEnd measurement racing the row's
    // layout (DM thread parity).
    return out.reverse();
  }, [messages, contentEvents, hasMore, firstUnreadId]);

  const rowsRef = useRef<ChatRow[]>([]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  // ── Initial position: the unread divider when one exists, newest otherwise
  // (the web's useScrollAndUnread anchor). One-shot: later messages never
  // re-position the reader.
  useEffect(() => {
    if (error) return;
    // The list is not mounted before the transition settles (see listSettled),
    // and this anchor is one-shot: running it against an unmounted list would
    // burn its only chance.
    if (!listSettled) return;
    if (!initialPositionReady || isLoading || !contentEventsReady) return;
    if (initialScrollDoneRef.current) return;
    initialScrollDoneRef.current = true;

    if (rows.length === 0) {
      initialPositionResolvedRef.current = true;
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
            // Inverted list: viewPosition runs from the visual bottom, so
            // 0.85 parks the divider near the top — where the web's
            // useScrollAndUnread anchor puts it (80px down, unread below).
            viewPosition: 0.85,
          });
        } else {
          listRef.current?.scrollToOffset({ offset: 0, animated: false });
        }
      } else {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
      }
      // One more frame lets the native scroll commit before the list paints.
      requestAnimationFrame(() => {
        initialPositionResolvedRef.current = true;
        setInitialPositionResolved(true);
      });
    });
  }, [
    initialPositionReady,
    isLoading,
    contentEventsReady,
    firstUnreadId,
    rows,
    error,
    listSettled,
  ]);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      // The list is inverted: offset 0 is the newest row, so the offset is
      // itself the distance from the bottom edge the pill cares about.
      const next = event.nativeEvent.contentOffset.y <= JUMP_PILL_THRESHOLD;
      atBottomRef.current = next;
      // Only re-render when the answer actually flips.
      setAtBottom((prev) => (prev === next ? prev : next));
    },
    [],
  );

  const scrollToLatest = useCallback((animated = true) => {
    if (!animated) {
      // An instant jump is authoritative: the reader is at the bottom from
      // this commit on, so the list prop below can step MVCP aside before
      // the new row mounts (a smooth glide instead lets scroll events drive
      // the pill, exactly like the web's scrollIntoView on the pill).
      atBottomRef.current = true;
      setAtBottom(true);
    }
    listRef.current?.scrollToOffset({ offset: 0, animated });
  }, []);

  /**
   * Follow the newest message while the reader is parked at the bottom — the
   * web's realtime follow (useScrollAndUnread Effect 3: smooth scroll to the
   * bottom anchor). Appended rows already land at the visual bottom of the
   * inverted list, so this is a no-op at offset 0; it closes the gap when the
   * reader was a few px up (≤ JUMP_PILL_THRESHOLD), when a row arrives while
   * a scroll animation is in flight, and when the temp → real id swap
   * re-anchors the viewport. 40ms is the DM thread's beat — it lets the row's
   * layout commit before the offset is steered to the new end.
   */
  useEffect(() => {
    const lastId = messages[messages.length - 1]?.id ?? null;
    if (!lastId || lastId === lastMessageIdRef.current) return undefined;
    const isFirstPage = lastMessageIdRef.current === null;
    lastMessageIdRef.current = lastId;
    if (isFirstPage || !initialPositionResolvedRef.current) return undefined;
    if (!atBottomRef.current) return undefined;
    const timer = setTimeout(() => scrollToLatest(true), 40);
    return () => clearTimeout(timer);
  }, [messages, scrollToLatest]);

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
      const message = messagesRef.current.find((m) => m.id === messageId);
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
    [id, updateReactions, user?.id],
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

  /** A sender's avatar or name — opens their read-only member profile. */
  const handleAuthorPress = useCallback(
    (userId: string) => {
      if (!userId || userId === user?.id) return;
      hapticSelection();
      router.push({ pathname: '/member/[id]', params: { id: userId } });
    },
    [router, user?.id],
  );

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
      // Own rows can arrive without a hydrated author (e.g. a realtime echo
      // cached before the profile landed) — the auth identity fills the gap.
      user_name:
        msg.users?.name ??
        (msg.user_id === user?.id ? user?.name ?? 'You' : 'Unknown'),
      user_id: msg.user_id,
    });
  }, [user?.id, user?.name]);

  /** Jumps the list to the message a reply quotes (web parity). */
  const handleReplyPress = useCallback(
    (messageId: string) => {
      const index = rowsRef.current.findIndex((row) => row.kind === 'message' && row.msg.id === messageId);
      if (index < 0) return;
      try {
        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
      } catch {
        listRef.current?.scrollToOffset({ offset: Math.max(0, index * 60), animated: true });
      }
      // Web flashMessage parity — tint the target row briefly so the land is
      // obvious, not just the scroll.
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      setFlashMessageId(messageId);
      flashTimerRef.current = setTimeout(() => setFlashMessageId(null), 1500);
    },
    [],
  );

  /** Jumps the list to the "created a …" card a reply quotes (web parity). */
  const handleContentChipPress = useCallback(
    (contentId: string) => {
      const index = rowsRef.current.findIndex(
        (row) => row.kind === 'content' && row.event.id === contentId,
      );
      if (index < 0) return;
      try {
        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
      } catch {
        listRef.current?.scrollToOffset({ offset: Math.max(0, index * 60), animated: true });
      }
    },
    [],
  );

  /**
   * A "created a …" card was tapped: open the post itself over the chat (the
   * mobile equivalent of the web card's link). The page's tab is only where
   * the post happens to live — tapping a link to one post is not a request to
   * browse that tab, so the active tab stays where it is.
   */
  const handleContentOpen = useCallback((event: ChatContentEvent) => {
    imeLayout.closePanel();
    setChatDetail({ kind: tabForChatContentKind(event.kind), id: event.id });
  }, [imeLayout.closePanel]);

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

  const lightboxImagesRef = useRef<LightboxImage[]>([]);
  useEffect(() => {
    lightboxImagesRef.current = lightboxImages;
  }, [lightboxImages]);

  const handleImagePress = useCallback(
    (url: string) => {
      const index = lightboxImagesRef.current.findIndex((img) => img.url === url);
      setImageIndex(index < 0 ? 0 : index);
    },
    [],
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
            onAuthorPress={handleAuthorPress}
            actionsOpen={selectedContent?.id === item.event.id}
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
          onAuthorPress={handleAuthorPress}
          onImagePress={handleImagePress}
          onCancel={handleCancel}
          onRetry={handleRetry}
          onReplyPress={handleReplyPress}
          onContentReplyPress={handleContentChipPress}
          onSwipeReply={handleMessageReply}
          highlighted={flashMessageId === item.msg.id}
          actionsOpen={selectedMessage?.id === item.msg.id}
        />
      );
    },
    [
      user?.id,
      handleLongPress,
      handleReaction,
      handleAuthorPress,
      handleImagePress,
      handleCancel,
      handleRetry,
      handleReplyPress,
      handleContentChipPress,
      handleMessageReply,
      handleContentOpen,
      handleContentLongPress,
      handleContentReaction,
      colors,
      initialUnreadCount,
      flashMessageId,
      selectedMessage?.id,
      selectedContent?.id,
    ],
  );

  const keyExtractor = useCallback((item: ChatRow) => item.key, []);

  const handleLoadMore = useCallback(() => {
    if (hasMore && !isLoadingMore) loadMore();
  }, [hasMore, isLoadingMore, loadMore]);

  const communityName =
    livePatch.name ?? resolved?.name ?? (name ? decodeURIComponent(name) : 'Community');
  // Route params carry the list row's snapshot so the name's badges paint on
  // the first frame; the resolved row then has the last word.
  const badgeType = resolved?.type ?? (typeParam ? decodeURIComponent(typeParam) : undefined);
  const badgeIsPrivate =
    livePatch.is_private ??
    resolved?.is_private ??
    (privateParam === undefined ? undefined : privateParam === '1');
  const headerBadges = communityNameBadges(badgeType, badgeIsPrivate);
  const routeImage = image ? decodeURIComponent(image) : null;
  const communityImage =
    livePatch.image_url !== undefined
      ? livePatch.image_url
      : (resolved?.image_url ?? routeImage);
  const infoCommunity = {
    id,
    name: communityName,
    image_url: communityImage,
    type: badgeType,
    is_private: badgeIsPrivate,
    member_count:
      detail?.member_count ??
      resolved?.member_count ??
      (members && Number.isFinite(Number(members)) ? Number(members) : null),
  };

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

      {(!listSettled || (isLoading && messages.length === 0)) && (
        <View style={styles.center}>
          {/* The UI accent, like every other loading state in the app — the
              own-bubble blue reads at ~3.5:1 against the chat background in the
              dark theme, a third of what the accent gets. */}
          <ActivityIndicator color={colors.accent} />
        </View>
      )}

      {listSettled && !isLoading && error && messages.length === 0 && (
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
        </View>
      )}

      {listSettled && (messages.length > 0 || (!isLoading && !error)) && (
        <FlatList
          ref={listRef}
          inverted
          data={rows}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          initialNumToRender={CHAT_LIST_PERFORMANCE.initialNumToRender}
          maxToRenderPerBatch={CHAT_LIST_PERFORMANCE.maxToRenderPerBatch}
          windowSize={CHAT_LIST_PERFORMANCE.windowSize}
          updateCellsBatchingPeriod={CHAT_LIST_PERFORMANCE.updateCellsBatchingPeriod}
          // A cached window is already the right thing to look at: show it at
          // once and let the bootstrap anchor it when the network settles (the
          // inverted list starts at offset 0 = the newest row).
          style={[styles.flex, { opacity: initialPositionResolved || messages.length > 0 ? 1 : 0 }]}
          contentContainerStyle={[styles.messagesList, { paddingTop: 8 }]}
          // Reading old messages means the user is done picking emoji —
          // close the inline panel so it doesn't eat half the screen.
          onScrollBeginDrag={imeLayout.closePanel}
          onScroll={handleScroll}
          scrollEventThrottle={32}
          // Web parity: the DOM list has no "keep the old anchor" behavior — a
          // new row at the bottom simply is the bottom. On the native list
          // that behavior is `maintainVisibleContentPosition`, and left on at
          // the bottom it re-anchors the previous row: the send/echo lands
          // just below the fold ("cut for a second") until a follow scroll
          // brings it back. Keep it for what it is for — holding the reading
          // position steady while scrolled up — and step it aside at the
          // bottom, where offset 0 keeps the new row in view by itself.
          maintainVisibleContentPosition={
            atBottom ? undefined : { minIndexForVisible: 0 }
          }
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
          // Inverted: older history sits at the visual top — the tail of the
          // list — so the pagination spinner is a footer (DM thread parity).
          ListFooterComponent={
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
                {communityImage ? (
                  <Image source={{ uri: communityImage }} style={styles.emptyAvatar} />
                ) : (
                  <CommunityIcon size={48} />
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

    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />

      {/* The header stays outside the chat's keyboard-managed viewport. */}
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
          onLayout={(e) => setHeaderCenterWidth(e.nativeEvent.layout.width)}
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
              <CommunityIcon size={40} />
            )}
            {headerBadges.verified && <VerifiedDpBadge dpSize={40} />}
          </DpWithEventDate>
          <View style={styles.headerTitles}>
            <View style={styles.headerTitleRow}>
              <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
                {communityName}
              </Text>
              {/* Invisible one-line copy: its width tells whether the real
                  title has to ellipsize before the badges can join it. */}
              <Text
                accessible={false}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                pointerEvents="none"
                numberOfLines={1}
                onLayout={(e) => setNameWidth(e.nativeEvent.layout.width)}
                style={[styles.headerTitle, styles.headerTitleMeasure]}
              >
                {communityName}
              </Text>
              {showNameBadges ? (
                <View onLayout={(e) => setBadgesWidth(e.nativeEvent.layout.width)}>
                  <CommunityNameBadges
                    type={badgeType}
                    isPrivate={badgeIsPrivate}
                    size={12}
                  />
                </View>
              ) : null}
            </View>
            {/* The web header's second line — how many members the room has,
                and (once anyone is connected) how many are online now. The
                count paints from the list snapshot first; a skeleton holds
                the line while a deep link resolves it, so it never snaps in
                a beat after the header. */}
            <View style={styles.headerMetaRow}>
              {memberCount !== null ? (
                <View style={styles.headerMetaItem}>
                  <Ionicons name="people" size={12} color={colors.mutedForeground} />
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

        {/* Community options — anchored under this button, WhatsApp-style:
            notifications (the old header bell), Delete chat, Exit community. */}
        <Pressable
          onPress={() => setMenuOpen(true)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Community options"
          style={({ pressed }) => [
            styles.headerIconBtn,
            { backgroundColor: pressed ? colors.surfaceRaised : 'transparent' },
          ]}
        >
          <Feather
            name="more-vertical"
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
                  imeLayout.closePanel();
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
                  <Text numberOfLines={1} style={[styles.tabText, { color: labelColor }]}>
                    {tab.label}
                  </Text>
                  {/* Absolute-positioned over the tab's padding: the dot is
                      visible without reserving width, so no tab grows to
                      make room for it. */}
                  <View
                    pointerEvents="none"
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
          <View style={styles.flex}>
            <View style={styles.flex}>
              {chatContent}
              <Animated.View
                pointerEvents="none"
                style={[styles.imeSpacer, imeLayout.listSpacerStyle]}
              />
            </View>

            {/* Mounted above the dock, anchored to the screen's bottom edge:
                a panel laid out below the composer's own bounds cannot receive
                touches on Android. */}
            <EmojiPicker
              onSelect={(emoji) => chatComposerRef.current?.insertEmoji(emoji)}
              height={imeLayout.panelHeight}
              animatedStyle={imeLayout.panelStyle}
              // The grid is ~170 cells (340 native views): mount it when the
              // panel opens, not with every chat open.
              showContent={imeLayout.panelOpen}
              interactive={imeLayout.panelInteractive}
            />

            <Animated.View
              pointerEvents="box-none"
              style={[styles.chatDock, imeLayout.dockStyle]}
            >
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

              <View onLayout={imeLayout.onTypingIndicatorLayout}>
                <TypingIndicator users={typingUsers} />
              </View>

              <ChatInput
                ref={chatComposerRef}
                communityId={id}
                currentUserId={user?.id ?? ''}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
                onSend={handleSend}
                onTypingChange={onInputChange}
                imeLayout={imeLayout}
              />
            </Animated.View>
          </View>
          {/* Match the gesture bar to the panel while it owns the bottom edge. */}
          <View
            style={{
              height: insets.bottom,
              backgroundColor: imeLayout.panelOpen ? colors.card : colors.background,
            }}
          />
        </>
      ) : (
        <CommunityContentView
          communityId={id}
          kind={activeTab as ContentKind}
          currentUserId={user?.id ?? ''}
          openContentId={openTarget && openTarget.tab === activeTab ? openTarget.id : null}
          onOpenConsumed={() => setOpenTarget(null)}
          canModerate={canModerateTab(activeTab as ContentKind)}
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
        canModerate={canModerateMessages}
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

      {/* A post opened from a "created a …" card in the chat — the page sits
          over the chat instead of switching tabs behind it. */}
      {chatDetail && (
        <ContentDetailOverlay
          communityId={id}
          communityName={communityName}
          kind={chatDetail.kind}
          contentId={chatDetail.id}
          currentUserId={user?.id ?? ''}
          onClose={() => setChatDetail(null)}
        />
      )}

      {/* Community info — WhatsApp-style, opened from the header title (the
          web right sidebar's content: members, about, rules) */}
      <CommunityInfoView
        visible={infoOpen}
        community={infoCommunity}
        onlineCount={onlineCount}
        currentUserId={user?.id ?? ''}
        isOwner={isOwnCommunity}
        canManageMembers={canManageMembers}
        canManageModerators={canManageModerators}
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

      {/* Header ⋯ menu — anchored under the button */}
      <CommunityMenu
        open={menuOpen}
        anchor={{ top: headerHeight + 6, right: 8 }}
        muted={muted}
        muteStateLabel={muteStateLabel}
        canOpenSettings={canOpenSettings}
        onOpenSettings={() =>
          router.push({
            pathname: '/community-settings/[id]',
            params: { id, name: communityName },
          })
        }
        onClose={() => setMenuOpen(false)}
        onOpenMuteOptions={() => {
          setMenuOpen(false);
          setMuteSheetOpen(true);
        }}
        onMute={(duration) => {
          // The menu dismisses first; the toast reports the save.
          setMenuOpen(false);
          void applyMute(duration);
        }}
        onConfirm={handleCommunityAction}
      />

      {/* Mute durations — opened from the ⋯ menu's mute row */}
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
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 12,
  },
  tab: {
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
    position: 'absolute',
    right: -6,
    top: '50%',
    marginTop: -2,
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
  headerTitleMeasure: {
    position: 'absolute',
    left: 0,
    top: 0,
    opacity: 0,
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
    // Inverted: paddingTop sits below the newest bubble, paddingBottom above
    // the oldest — the reverse of the non-inverted list this replaces.
    paddingBottom: 4,
  },
  dateDivider: {
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  /** Centered day chip — a small raised pill, as the DM thread draws it. */
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
  chatDock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 5,
    overflow: 'visible',
  },
  imeSpacer: { flexShrink: 0 },
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
