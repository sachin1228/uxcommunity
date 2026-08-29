import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { ImageViewer } from '@/components/chat/ImageViewer';
import { ChatInput, PendingImage } from '@/components/chat/ChatInput';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { EmojiPicker } from '@/components/chat/EmojiPicker';
import {
  toggleReaction,
  deleteMessage,
  Message,
} from '@/lib/communities';
import { useSendMessage } from '@/hooks/useSendMessage';
import { communityStore } from '@/lib/communityStore';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommunityContentView } from '@/components/community/CommunityContentView';
import type { CommunityTab, ContentKind } from '@/lib/communityContent';

export default function CommunityChat() {
  const { id, name, image, tabs: enabledTabsParam } = useLocalSearchParams<{ id: string; name: string; image?: string; tabs?: string }>();
  const colors = useColors();
  const colorScheme = useColorScheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [headerHeight, setHeaderHeight] = useState(0);
  const [activeTab, setActiveTab] = useState<CommunityTab>('chat');
  const enabledTabs = new Set(
    (enabledTabsParam ? decodeURIComponent(enabledTabsParam).split(',') : ['chat', 'threads', 'events', 'resources'])
      .map((tab) => tab.trim().toLowerCase())
  );
  const allTabs: Array<{ key: CommunityTab; label: string }> = [
    { key: 'chat', label: 'Chat' },
    { key: 'threads', label: 'Threads' },
    { key: 'events', label: 'Events' },
    { key: 'resources', label: 'Resources' },
  ];
  const tabs = allTabs.filter((tab) => tab.key === 'chat' || enabledTabs.has(tab.key));

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

  const { typingLabel, onInputChange, stopTyping } = useTypingPresence(id);

  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [viewingImageUri, setViewingImageUri] = useState<string | null>(null);

  const handleImagePress = useCallback((uri: string) => {
    setViewingImageUri(uri);
  }, []);

  const listRef = useRef<FlatList>(null);

  /**
   * isAtBottom — true when the last message in the list is currently visible
   * on screen. Updated by onViewableItemsChanged which is far more reliable
   * than scroll-offset arithmetic (no timing race, no threshold guessing).
   * Starts true because the chat always opens scrolled to the latest message.
   */
  const isAtBottom = useRef(true);
  const lastMessageIdRef = useRef<string | null>(null);

  // Keep lastMessageIdRef in sync so the viewability callback can reference it
  // without being recreated (FlatList requires a stable onViewableItemsChanged).
  useEffect(() => {
    lastMessageIdRef.current = messages[messages.length - 1]?.id ?? null;
  }, [messages]);

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 10 });
  const handleViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: Array<{ item: Message }> }) => {
      const lastId = lastMessageIdRef.current;
      if (!lastId) return;
      isAtBottom.current = viewableItems.some((vi) => vi.item.id === lastId);
    }
  );

  const scrollToLatest = useCallback((animated = true) => {
    listRef.current?.scrollToEnd({ animated });
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;

    const subscription = KeyboardEvents.addListener('keyboardDidShow', () => {
      // Only jump to the bottom when the last message is already visible.
      // If the user has scrolled up to read old messages, leave them there.
      if (isAtBottom.current) scrollToLatest(true);
    });

    return () => subscription.remove();
  }, [scrollToLatest]);

  const { handleSend: _handleSend, handleCancel, handleRetry } = useSendMessage({
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
    (text: string, pendingImage?: PendingImage) => {
      _handleSend(text, pendingImage, replyTo);
      setReplyTo(null);
    },
    [_handleSend, replyTo]
  );

  const handleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      try {
        const reactions = await toggleReaction(id, messageId, emoji);
        updateReactions(messageId, reactions);
      } catch {
        // silent
      }
    },
    [id, updateReactions]
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
    [id, softDeleteMessage]
  );

  const handleLongPress = useCallback((msg: Message) => {
    setSelectedMessage(msg);
  }, []);

  const renderItem = useCallback(
    ({ item, index }: { item: Message; index: number }) => {
      const prevMessage = index > 0 ? messages[index - 1] : null;
      // Group consecutive messages from the same sender (only for non-deleted)
      const isSameAuthor =
        !!prevMessage &&
        prevMessage.user_id === item.user_id &&
        !prevMessage.deleted_at &&
        !item.deleted_at;

      return (
        <MessageBubble
          message={item}
          isOwn={item.user_id === user?.id}
          isSameAuthor={isSameAuthor}
          onLongPress={handleLongPress}
          onReactionPress={handleReaction}
          onImagePress={handleImagePress}
          currentUserId={user?.id ?? ''}
          onCancel={handleCancel}
          onRetry={handleRetry}
        />
      );
    },
    [user?.id, handleLongPress, handleReaction, handleImagePress, handleCancel, handleRetry, messages]
  );

  const keyExtractor = useCallback((item: Message) => item.id, []);

  const handleLoadMore = useCallback(() => {
    if (hasMore && !isLoadingMore) loadMore();
  }, [hasMore, isLoadingMore, loadMore]);

  const communityName = name ? decodeURIComponent(name) : 'Chat';
  const communityImage = image ? decodeURIComponent(image) : null;

  const chatContent = (
    <View style={styles.flex}>
      {isLoading && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
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
          data={messages}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={[styles.messagesList, { paddingBottom: 8 }]}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          onViewableItemsChanged={handleViewableItemsChanged.current}
          viewabilityConfig={viewabilityConfig.current}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.2}
          ListHeaderComponent={
            isLoadingMore ? (
              <View style={styles.loadMoreSpinner}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Feather name="message-circle" size={36} color={colors.mutedForeground} />
              <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
                No messages yet. Say hello!
              </Text>
            </View>
          }
        />
      )}

      <View onLayout={() => { if (isAtBottom.current) scrollToLatest(false); }}>
        <TypingIndicator label={typingLabel} />

        <ChatInput
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={handleSend}
          onTypingChange={onInputChange}
        />
      </View>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.subtle }]}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />

      {/* Header measured for iOS keyboard offset. Android uses keyboard-controller height resize. */}
      <View
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
        style={[
          styles.header,
          {
            backgroundColor: colors.subtle,
            paddingTop: insets.top + 8,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} hitSlop={8} style={[styles.headerIconBtn, { backgroundColor: colors.mutedForeground + '20' }]}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </Pressable>

        <View style={styles.headerCenter}>
          {communityImage ? (
            <Image
              source={{ uri: communityImage }}
              style={styles.headerAvatar}
            />
          ) : (
            <View style={[styles.headerAvatar, styles.headerAvatarFallback, { backgroundColor: colors.primarySoft }]}>
              <Text style={[styles.headerAvatarText, { color: colors.primary }]}>
                {communityName.slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
          <View style={styles.headerTextCol}>
            <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
              {communityName}
            </Text>
            <Text style={[styles.headerSubtitle, { color: colors.mutedForeground }]} numberOfLines={1}>
              Public Community
            </Text>
          </View>
        </View>

        <View style={styles.headerActions}>
          <Pressable style={[styles.headerIconBtn, { backgroundColor: colors.mutedForeground + '20' }]}>
            <Feather name="search" size={18} color={colors.foreground} />
          </Pressable>
          <Pressable style={[styles.headerIconBtn, { backgroundColor: colors.mutedForeground + '20' }]}>
            <Feather name="more-horizontal" size={18} color={colors.foreground} />
          </Pressable>
        </View>
      </View>

      {/* Start a post banner */}
      <View style={[styles.postBanner, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={styles.postBannerLeft}>
          <Feather name="star" size={16} color="#a78bfa" />
          <Text style={[styles.postBannerText, { color: colors.mutedForeground }]}>
            Share your thoughts, ask questions,{'\n'}or showcase your work to the community.
          </Text>
        </View>
        <Pressable style={styles.startPostBtn}>
          <Feather name="plus" size={14} color="#fff" />
          <Text style={styles.startPostBtnText}>Start a post</Text>
        </Pressable>
      </View>

      <View style={[styles.tabsShell, { backgroundColor: colors.subtle, borderBottomColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
          {tabs.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={[styles.tab, active && { borderBottomColor: colors.primary }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
              >
                <Text style={[styles.tabText, { color: active ? colors.primary : colors.mutedForeground }]}>{tab.label}</Text>
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
          <View style={{ height: insets.bottom, backgroundColor: colors.subtle }} />
        </>
      ) : (
        <CommunityContentView
          communityId={id}
          kind={activeTab as ContentKind}
          currentUserId={user?.id ?? ''}
        />
      )}

      {/* Full-screen image viewer */}
      <ImageViewer
        uri={viewingImageUri}
        onClose={() => setViewingImageUri(null)}
      />

      {/* Long-press action sheet */}
      <EmojiPicker
        message={selectedMessage}
        isOwn={Boolean(selectedMessage && selectedMessage.user_id === user?.id)}
        onClose={() => setSelectedMessage(null)}
        onReact={handleReaction}
        onReply={(msg) => {
          setReplyTo(msg);
          setSelectedMessage(null);
        }}
        onDelete={handleDelete}
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
    paddingBottom: 10,
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
    gap: 10,
    minWidth: 0,
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
  headerTextCol: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: 'Geist_700Bold',
  },
  headerSubtitle: {
    fontSize: 12,
    fontFamily: 'Geist_400Regular',
    marginTop: 1,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flexShrink: 0,
  },
  headerIconBtn: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 99,
  },
  postBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  postBannerLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  postBannerText: {
    fontSize: 12,
    fontFamily: 'Geist_400Regular',
    lineHeight: 16,
    flex: 1,
  },
  startPostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#3b82f6',
    flexShrink: 0,
  },
  startPostBtnText: {
    color: '#fff',
    fontFamily: 'Geist_600SemiBold',
    fontSize: 12,
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
    paddingTop: 8,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Geist_400Regular',
    textAlign: 'center',
    marginTop: 8,
  },
});
