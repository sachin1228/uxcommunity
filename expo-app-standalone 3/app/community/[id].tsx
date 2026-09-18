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
import { useTypingPresence } from '@/hooks/useTypingPresence';
import { useAuth } from '@/context/AuthContext';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { ImageViewer, LightboxImage } from '@/components/chat/ImageViewer';
import { ChatInput, PendingImage } from '@/components/chat/ChatInput';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { MessageActionsSheet } from '@/components/chat/MessageActionsSheet';
import { EditMessageModal } from '@/components/chat/EditMessageModal';
import {
  setMessageReaction,
  deleteMessage,
  getCommunities,
  type Community,
  type Message,
} from '@/lib/communities';
import {
  fmtDate,
  myReactionEmoji,
  nextReactionIntent,
  projectOwnReaction,
  type MessageMention,
  type ReactionIntent,
} from '@/lib/chat';
import { useSendMessage } from '@/hooks/useSendMessage';
import { hapticToggle } from '@/lib/haptics';
import { communityStore } from '@/lib/communityStore';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommunityContentView } from '@/components/community/CommunityContentView';
import type { CommunityTab, ContentKind } from '@/lib/communityContent';

/** FlatList row: a day divider, the unread marker, or a message. */
type ChatRow =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'unread'; key: string }
  | { kind: 'message'; key: string; msg: Message; isSameAuthor: boolean };

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
  } = useLocalSearchParams<{
    id: string;
    name: string;
    image?: string;
    tabs?: string;
    showcase?: string;
    owner?: string;
    unread?: string;
    read?: string;
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
  /**
   * A push notification can only carry the community id, so when the route
   * arrives without its display params the community is resolved from the
   * signed-in member's list.
   */
  const [resolved, setResolved] = useState<Community | null>(null);
  const needsResolution = !name;

  useEffect(() => {
    if (!needsResolution) return;
    let cancelled = false;
    getCommunities()
      .then((list) => {
        if (!cancelled) setResolved(list.find((c) => c.id === id) ?? null);
      })
      .catch(() => {
        /* the header falls back to a generic title */
      });
    return () => {
      cancelled = true;
    };
  }, [id, needsResolution]);

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

  const { typingUsers, onInputChange, stopTyping } = useTypingPresence(id);

  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const [copiedNotice, setCopiedNotice] = useState(false);
  const [imageIndex, setImageIndex] = useState<number | null>(null);

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
  useEffect(() => {
    if (unreadLatchedRef.current || messages.length === 0 || !readStateKnown) return;
    unreadLatchedRef.current = true;
    if (!lastReadAt || initialUnreadCount <= 0) return;
    const firstUnread = messages.find(
      (m) => m.created_at > lastReadAt && m.user_id !== user?.id,
    );
    if (firstUnread) setFirstUnreadId(firstUnread.id);
  }, [messages, lastReadAt, initialUnreadCount, user?.id, readStateKnown]);

  // ── Rows: day dividers + unread marker interleaved with messages ─────────
  const rows = useMemo<ChatRow[]>(() => {
    const out: ChatRow[] = [];
    let currentDate: string | null = null;
    let prevAuthorId: string | null = null;
    let groupIndex = 0;
    let unreadPlaced = false;

    for (const msg of messages) {
      const day = fmtDate(msg.created_at);
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
    return out;
  }, [messages, hasMore, firstUnreadId]);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    lastMessageIdRef.current = lastMessage?.id ?? null;
  }, [messages]);

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
    setCopiedNotice(true);
    setTimeout(() => setCopiedNotice(false), 1400);
  }, []);

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
      {copiedNotice && (
        <View style={[styles.toast, { backgroundColor: colors.foreground }]}>
          <Feather name="check" size={13} color={colors.background} />
          <Text style={[styles.toastText, { color: colors.background }]}>Copied</Text>
        </View>
      )}

      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.chatOwnBubble} />
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
                <ActivityIndicator size="small" color={colors.chatOwnBubble} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
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
          <Feather name="arrow-left" size={26} color={colors.foreground} />
        </Pressable>

        <View style={styles.headerCenter}>
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
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
            {communityName}
          </Text>
        </View>
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
            return (
              <Pressable
                key={tab.key}
                onPress={() => {
                  setEmojiPanelOpen(false);
                  setActiveTab(tab.key);
                }}
                style={[styles.tab, active && { borderBottomColor: colors.chatOwnBubble }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text
                  style={[
                    styles.tabText,
                    { color: active ? colors.foreground : colors.mutedForeground },
                  ]}
                >
                  {tab.label}
                </Text>
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
        onReply={(msg) => setReplyTo(msg)}
        onCopy={handleCopy}
        onEdit={(msg) => {
          clearEditError();
          setEditingMessage(msg);
        }}
        onDelete={handleDelete}
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
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabText: {
    fontSize: 14,
    fontFamily: 'Geist_600SemiBold',
  },
  headerAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  headerAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarText: {
    fontSize: 12,
    fontFamily: 'Geist_600SemiBold',
  },
  headerTitle: {
    fontSize: 17,
    fontFamily: 'Geist_600SemiBold',
    flexShrink: 1,
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
});
