import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView as RNKeyboardAvoidingView,
  Platform,
  Pressable,
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
import { ChatInput, PendingImage } from '@/components/chat/ChatInput';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { EmojiPicker } from '@/components/chat/EmojiPicker';
import {
  sendMessage,
  toggleReaction,
  deleteMessage,
  uploadChatImage,
  Message,
} from '@/lib/communities';
import { communityStore } from '@/lib/communityStore';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function CommunityChat() {
  const { id, name, image } = useLocalSearchParams<{ id: string; name: string; image?: string }>();
  const colors = useColors();
  const colorScheme = useColorScheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const [headerHeight, setHeaderHeight] = useState(0);

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
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    loadMore,
    appendMessage,
    updateReactions,
    softDeleteMessage,
  } = useChatMessages(id);

  const { typingLabel, onInputChange, stopTyping } = useTypingPresence(id);

  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  // True while uploading an image or waiting for the send API response
  const [isSending, setIsSending] = useState(false);
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

  const handleSend = useCallback(
    async (text: string, pendingImage?: PendingImage) => {
      if (!text.trim() && !pendingImage) return;
      setIsSending(true);
      stopTyping();
      try {
        // Upload image first if one is attached
        let imageUrl: string | undefined;
        if (pendingImage) {
          imageUrl = await uploadChatImage(id, pendingImage.uri, pendingImage.mimeType);
        }

        const msg = await sendMessage(id, {
          content: text || undefined,
          reply_to_id: replyTo?.id,
          image_url: imageUrl,
        });

        appendMessage({
          ...msg,
          users: user
            ? { name: user.name, avatar_url: user.avatar_url ?? null, designation: null, company: null }
            : null,
          reactions: [],
          reply_to: replyTo
            ? {
                id: replyTo.id,
                content: replyTo.content,
                user_name: replyTo.users?.name ?? 'Unknown',
              }
            : null,
        });

        setReplyTo(null);
        scrollToLatest(true);
      } catch {
        // Error visible in UI if needed
      } finally {
        setIsSending(false);
      }
    },
    [id, replyTo, appendMessage, scrollToLatest, stopTyping, user]
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
          currentUserId={user?.id ?? ''}
        />
      );
    },
    [user?.id, handleLongPress, handleReaction, messages]
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
          disabled={isSending}
        />
      </View>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />

      {/* Header measured for iOS keyboard offset. Android uses keyboard-controller height resize. */}
      <View
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
        style={[
          styles.header,
          {
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
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
                { backgroundColor: colors.primarySoft },
              ]}
            >
              <Text style={[styles.headerAvatarText, { color: colors.primary }]}>
                {communityName.slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
          <Text
            style={[styles.headerTitle, { color: colors.foreground }]}
            numberOfLines={1}
          >
            {communityName}
          </Text>
        </View>

        <View style={{ width: 36 }} />
      </View>

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

      {/* Bottom safe-area strip — rendered outside the keyboard container so it
          never moves with the keyboard. Fills the gesture-navigation area with
          the app background color, exactly like WhatsApp. On iOS this covers
          the home-indicator inset; on Android it covers the gesture nav bar. */}
      <View style={{ height: insets.bottom, backgroundColor: colors.background }} />

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
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
    justifyContent: 'center',
    gap: 8,
    minWidth: 0,
  },
  headerAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  headerAvatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarText: {
    fontSize: 15,
    fontFamily: 'Geist_600SemiBold',
  },
  headerTitle: {
    fontSize: 20,
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
    paddingTop: 8,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Geist_400Regular',
    textAlign: 'center',
    marginTop: 8,
  },
});
