/**
 * DM thread — the mobile rendering of the web /dashboard/messages pane.
 *
 * Own messages on the right (chat bubble tokens), the peer's on the left;
 * optimistic sends are confirmed by id (the realtime echo can arrive first);
 * every send carries a client nonce so a retry can never duplicate. The
 * footer follows the same state machine as the web: blocked bar, Accept/
 * Reject for an incoming request, the one-message hint for an outgoing one,
 * a declined notice, else the composer. Reading marks the newest displayed
 * message (throttled), which clears the header badge.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { setDmActiveConversation, signalDmListChanged } from '@/hooks/useDmUnread';
import { realtimeClient, realtimeRooms } from '@/lib/realtime';
import {
  answerDmRequest,
  getDmConversations,
  getDmMessages,
  markDmRead,
  sendDmMessage,
  unblockUser,
} from '@/lib/dmApi';
import {
  DM_MAX_CONTENT_CHARS,
  dmComposerState,
  newestMessageAt,
  requestHintForPeer,
  uuidV4,
  type DmConversation,
  type DmMessage,
} from '@/lib/dm';

const MARK_READ_THROTTLE_MS = 2_000;

interface RealtimeDmPayload {
  id: string;
  conversation_id: string;
  user_id: string;
  sender_name?: string;
  sender_avatar_url?: string | null;
  content?: string;
  created_at: string;
  reply_to_id?: string | null;
  reply_sender_name?: string | null;
  image_url?: string | null;
}

export default function DmThreadScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const params = useLocalSearchParams<{ id: string; name?: string; avatar?: string }>();
  const conversationId = params.id;
  const peerName = params.name ?? 'Member';

  const [conversation, setConversation] = useState<DmConversation | null>(null);
  /** Oldest first, like the server orders a page. */
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);

  /** temp message id → client nonce, to confirm the bubble on the response. */
  const pendingNoncesRef = useRef(new Map<string, string>());
  const loadingMoreRef = useRef(false);
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMarkedRef = useRef<string | null>(null);
  const lastMarkCallRef = useRef(0);

  const load = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    setError(null);
    try {
      const [page, conversations] = await Promise.all([
        getDmMessages(conversationId),
        getDmConversations().catch(() => [] as DmConversation[]),
      ]);
      setMessages(page.messages);
      setHasMore(page.hasMore);
      setConversation(conversations.find((row) => row.id === conversationId) ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load this conversation.');
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load]);

  // While this thread is open the badge must not bump for its own messages.
  useEffect(() => {
    setDmActiveConversation(conversationId ?? null);
    return () => setDmActiveConversation(null);
  }, [conversationId]);

  // ── Read marking: the newest displayed message, throttled ────────────────
  const markReadNow = useCallback(
    (force = false) => {
      if (!conversationId) return;
      const newest = newestMessageAt(messages);
      if (!newest) return;
      if (lastMarkedRef.current === newest) return;

      const fire = () => {
        lastMarkedRef.current = newest;
        lastMarkCallRef.current = Date.now();
        void markDmRead(conversationId, newest)
          .then(() => signalDmListChanged())
          .catch(() => {
            /* the next message or open retries */
          });
      };

      if (force || Date.now() - lastMarkCallRef.current > MARK_READ_THROTTLE_MS) {
        fire();
      } else if (!markReadTimerRef.current) {
        markReadTimerRef.current = setTimeout(() => {
          markReadTimerRef.current = null;
          fire();
        }, MARK_READ_THROTTLE_MS);
      }
    },
    [conversationId, messages],
  );

  useEffect(() => {
    markReadNow();
  }, [markReadNow]);

  useEffect(() => {
    return () => {
      if (markReadTimerRef.current) clearTimeout(markReadTimerRef.current);
    };
  }, []);

  // ── Realtime: dm-message / dm-request-update / edits / deletes ───────────
  useEffect(() => {
    if (!userId || !conversationId) return;

    realtimeClient.init({ id: userId, name: user?.name ?? null, avatar: null });
    const room = realtimeRooms.dm(userId);
    realtimeClient.connect(room);

    const unsubscribes: Array<() => void> = [];

    unsubscribes.push(
      realtimeClient.on(room, 'dm-message', (data) => {
        const payload = data as RealtimeDmPayload | null;
        if (!payload?.id || payload.conversation_id !== conversationId) return;
        setMessages((current) => {
          if (current.some((message) => message.id === payload.id)) return current;

          const incoming: DmMessage = {
            id: payload.id,
            content: payload.content ?? null,
            created_at: payload.created_at,
            user_id: payload.user_id,
            reply_to_id: payload.reply_to_id ?? null,
            image_url: payload.image_url ?? null,
            deleted_at: null,
            edited_at: null,
            users: payload.sender_name
              ? { name: payload.sender_name, avatar_url: payload.sender_avatar_url ?? null }
              : null,
            reactions: [],
            reply_to: payload.reply_to_id
              ? {
                  id: payload.reply_to_id,
                  content: null,
                  user_name: payload.reply_sender_name ?? '',
                  user_id: null,
                }
              : null,
          };

          // The echo confirms our own optimistic bubble (matched by sender and
          // content within the pending window) — drop the temp copy.
          if (payload.user_id === userId) {
            for (const [tempId] of pendingNoncesRef.current) {
              const temp = current.find((message) => message.id === tempId);
              if (temp && temp.content === (payload.content ?? null)) {
                pendingNoncesRef.current.delete(tempId);
                return [...current.filter((message) => message.id !== tempId), incoming];
              }
            }
          }
          return [...current, incoming];
        });
      }),
    );

    unsubscribes.push(
      realtimeClient.on(room, 'dm-request-update', (data) => {
        const payload = data as {
          conversation_id?: string;
          request_state?: DmConversation['request_state'];
          requested_by?: string | null;
        } | null;
        if (!payload || payload.conversation_id !== conversationId) return;
        setConversation((current) =>
          current
            ? {
                ...current,
                request_state: payload.request_state ?? current.request_state,
                requested_by:
                  payload.requested_by !== undefined
                    ? payload.requested_by
                    : current.requested_by,
              }
            : current,
        );
      }),
    );

    unsubscribes.push(
      realtimeClient.on(room, 'dm-message-edit', (data) => {
        const payload = data as RealtimeDmPayload | null;
        if (!payload?.id || payload.conversation_id !== conversationId) return;
        setMessages((current) =>
          current.map((message) =>
            message.id === payload.id
              ? {
                  ...message,
                  content: payload.content ?? message.content,
                  edited_at: new Date().toISOString(),
                }
              : message,
          ),
        );
      }),
    );

    unsubscribes.push(
      realtimeClient.on(room, 'dm-message-delete', (data) => {
        const payload = data as RealtimeDmPayload | null;
        if (!payload?.id || payload.conversation_id !== conversationId) return;
        setMessages((current) =>
          current.map((message) =>
            message.id === payload.id
              ? {
                  ...message,
                  content: null,
                  image_url: null,
                  reply_to_id: null,
                  reply_to: null,
                  deleted_at: new Date().toISOString(),
                }
              : message,
          ),
        );
      }),
    );

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
    };
  }, [userId, user?.name, conversationId]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore || messages.length === 0 || !conversationId) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const oldest = messages[0];
    try {
      const page = await getDmMessages(conversationId, {
        createdAt: oldest.created_at,
        id: oldest.id,
      });
      setMessages((current) => {
        const seen = new Set(current.map((message) => message.id));
        return [...page.messages.filter((message) => !seen.has(message.id)), ...current];
      });
      setHasMore(page.hasMore);
    } catch {
      // Keep the timeline; the next scroll retries.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [conversationId, hasMore, messages]);

  // ── Sending ───────────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    const content = draft.trim();
    if (!content || sending || !conversationId || !userId) return;

    const nonce = uuidV4();
    const tempId = `temp:${nonce}`;
    pendingNoncesRef.current.set(tempId, nonce);

    const optimistic: DmMessage = {
      id: tempId,
      content,
      created_at: new Date().toISOString(),
      user_id: userId,
      reply_to_id: null,
      image_url: null,
      deleted_at: null,
      edited_at: null,
      users: null,
      reactions: [],
      reply_to: null,
    };

    setMessages((current) => [...current, optimistic]);
    setDraft('');
    setSendError(null);
    setSending(true);
    try {
      const result = await sendDmMessage(conversationId, content, nonce);
      pendingNoncesRef.current.delete(tempId);
      setMessages((current) => {
        const echoAlready = current.some((message) => message.id === result.message.id);
        const withoutTemp = current.filter((message) => message.id !== tempId);
        return echoAlready ? withoutTemp : [...withoutTemp, result.message];
      });
      setConversation((current) =>
        current
          ? {
              ...current,
              request_state: result.requestState,
              requested_by: result.requestedBy,
            }
          : current,
      );
    } catch (e) {
      pendingNoncesRef.current.delete(tempId);
      setMessages((current) => current.filter((message) => message.id !== tempId));
      setDraft(content); // hand the text back so nothing is lost
      setSendError(e instanceof Error ? e.message : 'The message could not be sent.');
    } finally {
      setSending(false);
    }
  }, [conversationId, draft, sending, userId]);

  const answer = useCallback(
    async (action: 'accept' | 'reject') => {
      if (!conversationId || answering) return;
      setAnswering(true);
      try {
        await answerDmRequest(conversationId, action);
        setConversation((current) =>
          current
            ? { ...current, request_state: action === 'accept' ? 'accepted' : 'rejected' }
            : current,
        );
      } catch (e) {
        setSendError(e instanceof Error ? e.message : 'The answer could not be saved.');
      } finally {
        setAnswering(false);
      }
    },
    [answering, conversationId],
  );

  const liftBlock = useCallback(async () => {
    if (!conversation?.peer.id) return;
    try {
      await unblockUser(conversation.peer.id);
      setConversation((current) => (current ? { ...current, blocked_by_me: false } : current));
    } catch {
      setSendError('The block could not be removed. Please try again.');
    }
  }, [conversation?.peer.id]);

  const composerState = useMemo(
    () =>
      conversation && userId
        ? dmComposerState(conversation, userId)
        : ({ kind: 'ready' } as const),
    [conversation, userId],
  );

  /** Newest first for the inverted list. */
  const rendered = useMemo(() => [...messages].reverse(), [messages]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />

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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          hitSlop={10}
          onPress={() => router.back()}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
          {conversation?.peer.name ?? peerName}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={28} color={colors.foregroundMuted} />
          <Text style={[styles.stateTitle, { color: colors.foreground }]}>
            Couldn&apos;t load conversation
          </Text>
          <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>{error}</Text>
          <Pressable onPress={() => void load()} accessibilityRole="button">
            <Text style={[styles.retry, { color: colors.accent }]}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <FlatList
            inverted
            data={rendered}
            keyExtractor={(message) => message.id}
            renderItem={({ item }) => (
              <MessageBubble message={item} isOwn={item.user_id === userId} />
            )}
            contentContainerStyle={styles.list}
            onEndReached={() => void loadMore()}
            onEndReachedThreshold={0.3}
            ListEmptyComponent={
              <View style={styles.emptyThread}>
                <Text style={[styles.stateTitle, { color: colors.foregroundMuted }]}>
                  No messages yet
                </Text>
                <Text style={[styles.stateBody, { color: colors.foregroundSubtle }]}>
                  Say hi to {conversation?.peer.name ?? peerName}.
                </Text>
              </View>
            }
            ListFooterComponent={
              loadingMore ? (
                <View style={styles.moreSpinner}>
                  <ActivityIndicator size="small" color={colors.foregroundMuted} />
                </View>
              ) : null
            }
          />

          {sendError ? (
            <Text style={[styles.sendError, { color: colors.destructive }]}>{sendError}</Text>
          ) : null}

          {composerState.kind === 'blocked' ? (
            <FooterBar>
              <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
                You blocked {conversation?.peer.name ?? peerName}. They can&apos;t send you
                messages.
              </Text>
              <Pressable accessibilityRole="button" onPress={() => void liftBlock()}>
                <Text style={[styles.footerAction, { color: colors.accent }]}>Unblock</Text>
              </Pressable>
            </FooterBar>
          ) : composerState.kind === 'incoming-request' ? (
            <FooterBar>
              <View style={styles.requestInfo}>
                <Text style={[styles.footerText, { color: colors.foreground }]}>
                  {conversation?.peer.name ?? peerName} wants to message you
                </Text>
                <Text style={[styles.footerHint, { color: colors.mutedForeground }]}>
                  Accept to chat, or decline to close this conversation.
                </Text>
              </View>
              <View style={styles.requestActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={answering}
                  onPress={() => void answer('reject')}
                  style={[styles.requestButton, { borderColor: colors.borderStrong }]}
                >
                  <Text style={[styles.requestButtonText, { color: colors.foreground }]}>
                    Decline
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={answering}
                  onPress={() => void answer('accept')}
                  style={[
                    styles.requestButton,
                    { borderColor: colors.accent, backgroundColor: colors.accent },
                  ]}
                >
                  <Text style={[styles.requestButtonText, { color: colors.accentForeground }]}>
                    Accept
                  </Text>
                </Pressable>
              </View>
            </FooterBar>
          ) : composerState.kind === 'outgoing-request' ? (
            <FooterBar>
              <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
                {requestHintForPeer(conversation?.peer.name ?? peerName)}
              </Text>
            </FooterBar>
          ) : composerState.kind === 'rejected' ? (
            <FooterBar>
              <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
                Your message request was declined — you can&apos;t send more messages here.
              </Text>
            </FooterBar>
          ) : (
            <View
              style={[
                styles.composer,
                {
                  borderTopColor: colors.border,
                  paddingBottom: insets.bottom + 8,
                  backgroundColor: colors.background,
                },
              ]}
            >
              <TextInput
                value={draft}
                onChangeText={(text) => setDraft(text.slice(0, DM_MAX_CONTENT_CHARS))}
                placeholder="Message"
                placeholderTextColor={colors.foregroundSubtle}
                multiline
                style={[
                  styles.input,
                  {
                    color: colors.foreground,
                    backgroundColor: colors.input,
                    borderColor: colors.inputBorder,
                  },
                ]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send"
                disabled={!draft.trim() || sending}
                onPress={() => void send()}
                style={[
                  styles.sendButton,
                  { backgroundColor: colors.chatOwnBubble },
                  (!draft.trim() || sending) && { opacity: 0.5 },
                ]}
              >
                {sending ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Feather name="arrow-up" size={18} color="#FFFFFF" />
                )}
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

function FooterBar({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.footerBar,
        {
          borderTopColor: colors.border,
          backgroundColor: colors.background,
          paddingBottom: insets.bottom + 12,
        },
      ]}
    >
      {children}
    </View>
  );
}

function MessageBubble({ message, isOwn }: { message: DmMessage; isOwn: boolean }) {
  const colors = useColors();
  const [imageFailed, setImageFailed] = useState(false);

  if (message.deleted_at) {
    return (
      <View style={[styles.bubbleRow, isOwn ? styles.bubbleRowOwn : styles.bubbleRowOther]}>
        <View
          style={[
            styles.bubble,
            isOwn ? styles.bubbleOwn : styles.bubbleOther,
            { backgroundColor: colors.surfaceRaised },
          ]}
        >
          <Text style={[styles.bubbleText, { color: colors.foregroundSubtle, fontStyle: 'italic' }]}>
            This message was deleted
          </Text>
        </View>
      </View>
    );
  }

  const isPending = message.id.startsWith('temp:');

  return (
    <View style={[styles.bubbleRow, isOwn ? styles.bubbleRowOwn : styles.bubbleRowOther]}>
      <View
        style={[
          styles.bubble,
          isOwn
            ? { backgroundColor: colors.chatOwnBubble, borderBottomRightRadius: 4 }
            : { backgroundColor: colors.surfaceRaised, borderBottomLeftRadius: 4 },
          isPending && { opacity: 0.7 },
        ]}
      >
        {message.reply_to ? (
          <View
            style={[
              styles.replyPreview,
              { borderLeftColor: isOwn ? colors.chatReplyBorderOwn : colors.chatReplyBorderOther },
            ]}
          >
            <Text
              style={[styles.replyName, { color: isOwn ? '#FFFFFF' : colors.foreground }]}
              numberOfLines={1}
            >
              {message.reply_to.user_name}
            </Text>
            {message.reply_to.content ? (
              <Text
                style={[styles.replyText, { color: isOwn ? '#FFFFFF' : colors.mutedForeground }]}
                numberOfLines={1}
              >
                {message.reply_to.content}
              </Text>
            ) : null}
          </View>
        ) : null}

        {message.image_url && !imageFailed ? (
          <Image
            source={{ uri: message.image_url }}
            style={styles.bubbleImage}
            resizeMode="contain"
            onError={() => setImageFailed(true)}
          />
        ) : null}

        {message.content ? (
          <Text style={[styles.bubbleText, { color: isOwn ? '#FFFFFF' : colors.foreground }]}>
            {message.content}
          </Text>
        ) : null}

        {message.reactions.length > 0 ? (
          <View style={styles.reactionsRow}>
            {message.reactions.map((reaction) => (
              <Text key={reaction.emoji} style={styles.reactionChip}>
                {reaction.emoji} {reaction.user_ids.length}
              </Text>
            ))}
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
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: { padding: 2 },
  headerTitle: { flex: 1, fontFamily: 'Geist_600SemiBold', fontSize: 17, textAlign: 'center' },
  headerSpacer: { width: 26 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  stateTitle: { fontFamily: 'Geist_600SemiBold', fontSize: 16, textAlign: 'center' },
  stateBody: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  retry: { fontFamily: 'Geist_600SemiBold', fontSize: 14 },
  list: { padding: 12, gap: 6, flexGrow: 1 },
  emptyThread: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 32,
    // The list is inverted, so the empty state would render mirrored.
    transform: [{ scaleY: -1 }],
  },
  moreSpinner: { paddingVertical: 16, alignItems: 'center' },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowOwn: { justifyContent: 'flex-end' },
  bubbleRowOther: { justifyContent: 'flex-start' },
  bubble: {
    maxWidth: '78%',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
  },
  bubbleOwn: { borderBottomRightRadius: 4 },
  bubbleOther: { borderBottomLeftRadius: 4 },
  bubbleText: { fontFamily: 'Geist_400Regular', fontSize: 14.5, lineHeight: 20 },
  bubbleImage: { width: 220, height: 220, borderRadius: 10, marginBottom: 2 },
  replyPreview: {
    borderLeftWidth: 2,
    paddingLeft: 7,
    marginBottom: 2,
    opacity: 0.9,
  },
  replyName: { fontFamily: 'Geist_600SemiBold', fontSize: 12 },
  replyText: { fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 1 },
  reactionsRow: { flexDirection: 'row', gap: 4, marginTop: 2 },
  reactionChip: { fontSize: 12, color: '#FFFFFF' },
  sendError: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12.5,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },
  footerBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 10,
  },
  footerText: { fontFamily: 'Geist_400Regular', fontSize: 13, lineHeight: 19, flex: 1 },
  footerHint: { fontFamily: 'Geist_400Regular', fontSize: 12, marginTop: 2 },
  footerAction: { fontFamily: 'Geist_600SemiBold', fontSize: 13.5 },
  requestInfo: { gap: 2 },
  requestActions: { flexDirection: 'row', gap: 10 },
  requestButton: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestButtonText: { fontFamily: 'Geist_600SemiBold', fontSize: 13.5 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  input: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 9,
    paddingBottom: 9,
    maxHeight: 120,
    fontFamily: 'Geist_400Regular',
    fontSize: 14.5,
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
