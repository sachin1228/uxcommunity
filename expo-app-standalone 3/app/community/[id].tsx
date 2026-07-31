import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useColors } from '@/hooks/useColors';
import { useChatMessages } from '@/hooks/useChatMessages';
import { useTypingPresence } from '@/hooks/useTypingPresence';
import { useAuth } from '@/context/AuthContext';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { ChatInput } from '@/components/chat/ChatInput';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { EmojiPicker } from '@/components/chat/EmojiPicker';
import { sendMessage, toggleReaction, Message } from '@/lib/communities';
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

  // Track this as the active community so useCommunities won't increment
  // unread_count for incoming messages while we're looking at this chat.
  // Mirrors web's activeCommunityIdRef guard in useSidebarRealtime.
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
  } = useChatMessages(id);

  const { typingLabel, onInputChange, stopTyping } = useTypingPresence(id);

  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [isSending, setIsSending] = useState(false);
  const listRef = useRef<FlatList>(null);

  const handleSend = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      setIsSending(true);
      stopTyping();
      try {
        const msg = await sendMessage(id, {
          content: text,
          reply_to_id: replyTo?.id,
        });
        appendMessage({
          ...msg,
          users: user ? { name: user.name, avatar_url: null, designation: null, company: null } : null,
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
        // Scroll to bottom
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
      } catch (e) {
        // Error is visible in UI if needed
      } finally {
        setIsSending(false);
      }
    },
    [id, replyTo, appendMessage, stopTyping, user]
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

  const handleLongPress = useCallback((msg: Message) => {
    setSelectedMessage(msg);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Message }) => (
      <MessageBubble
        message={item}
        isOwn={item.user_id === user?.id}
        onLongPress={handleLongPress}
        onReactionPress={handleReaction}
        currentUserId={user?.id ?? ''}
      />
    ),
    [user?.id, handleLongPress, handleReaction]
  );

  const keyExtractor = useCallback((item: Message) => item.id, []);

  const handleLoadMore = useCallback(() => {
    if (hasMore && !isLoadingMore) loadMore();
  }, [hasMore, isLoadingMore, loadMore]);

  const communityName = name ? decodeURIComponent(name) : 'Chat';
  const communityImage = image ? decodeURIComponent(image) : null;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />

      {/* Header */}
      <View
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

        {/* Community image + name */}
        <View style={styles.headerCenter}>
          {communityImage ? (
            <Image
              source={{ uri: communityImage }}
              style={[styles.headerAvatar, { borderColor: colors.border }]}
            />
          ) : (
            <View style={[styles.headerAvatar, styles.headerAvatarFallback, { backgroundColor: colors.primarySoft }]}>
              <Text style={[styles.headerAvatarText, { color: colors.primary }]}>
                {communityName.slice(0, 1).toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
            {communityName}
          </Text>
        </View>

        <View style={{ width: 36 }} />
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {/* Loading */}
        {isLoading && (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}

        {/* Error */}
        {!isLoading && error && (
          <View style={styles.center}>
            <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
          </View>
        )}

        {/* Messages */}
        {!isLoading && (
          <FlatList
            ref={listRef}
            data={messages}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            contentContainerStyle={[
              styles.messagesList,
              { paddingBottom: 8 },
            ]}
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

        {/* Typing indicator */}
        <TypingIndicator label={typingLabel} />

        {/* Input */}
        <View style={{ paddingBottom: insets.bottom }}>
          <ChatInput
            replyTo={replyTo}
            onCancelReply={() => setReplyTo(null)}
            onSend={handleSend}
            onTypingChange={onInputChange}
            disabled={isSending}
          />
        </View>
      </KeyboardAvoidingView>

      {/* Emoji / action picker */}
      <EmojiPicker
        message={selectedMessage}
        onClose={() => setSelectedMessage(null)}
        onReact={handleReaction}
        onReply={(msg) => {
          setReplyTo(msg);
          setSelectedMessage(null);
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
