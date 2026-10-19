/**
 * DM thread — the mobile rendering of the web /dashboard/messages pane, built
 * on the SAME chat primitives as a community room: MessageBubble, the
 * long-press action sheet (reactions, reply, copy, edit, delete), the edit
 * modal, the image lightbox and the typing indicator. Only the community-only
 * timeline devices (tabs, content cards, watermark) are absent.
 *
 * The footer is the web thread's state machine: blocked, incoming request,
 * outgoing request, rejected, else the composer. A brand-new conversation is
 * synthesized from the route's peer (the server keeps empty conversations out
 * of the list) so the one-message request hint is shown before the first send.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView as RNKeyboardAvoidingView,
  Modal,
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
import { Feather, Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { EditMessageModal } from '@/components/chat/EditMessageModal';
import { ImageViewer, type LightboxImage } from '@/components/chat/ImageViewer';
import { MessageActionsSheet } from '@/components/chat/MessageActionsSheet';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { TypingIndicator } from '@/components/chat/TypingIndicator';
import { DmComposer } from '@/components/dm/DmComposer';
import { DmReportModal } from '@/components/dm/DmReportModal';
import { PersonAvatar } from '@/components/PersonAvatar';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { setDmActiveConversation, signalDmListChanged } from '@/hooks/useDmUnread';
import { useDmSend } from '@/hooks/useDmSend';
import { useDmTyping } from '@/hooks/useDmTyping';
import { chatCache } from '@/lib/chatCacheStore';
import {
  answerDmRequest,
  blockUser,
  getDmConversations,
  getDmMessages,
  getDmMessagesAfter,
  markDmRead,
  setDmMessageReaction,
  unblockUser,
} from '@/lib/dmApi';
import {
  dmComposerState,
  isUnstartedRequest,
  newestMessageAt,
  requestHintForPeer,
  type DmConversation,
  type DmMessage,
} from '@/lib/dm';
import type { ReplyDraft } from '@/lib/chatContentEvents';
import {
  applyReactionDelete,
  applyReactionInsert,
  fmtDate,
  myReactionEmoji,
  nextReactionIntent,
  projectOwnReaction,
  type ReactionIntent,
} from '@/lib/chat';
import { hapticSelection, hapticToggle } from '@/lib/haptics';
import { realtimeClient, realtimeRooms } from '@/lib/realtime';

const MARK_READ_THROTTLE_MS = 2_000;
const CATCH_UP_DEBOUNCE_MS = 600;

interface RealtimeDmPayload {
  id: string;
  conversation_id: string;
  user_id: string;
  sender_name?: string | null;
  sender_avatar_url?: string | null;
  content?: string | null;
  created_at: string;
  reply_to_id?: string | null;
  reply_sender_name?: string | null;
  reply_sender_id?: string | null;
  image_url?: string | null;
  edited_at?: string | null;
}

type ThreadRow =
  | { kind: 'date'; key: string; label: string }
  | { kind: 'unread'; key: string; count: number }
  | { kind: 'message'; key: string; msg: DmMessage; isSameAuthor: boolean };

function sortMessages(messages: DmMessage[]): DmMessage[] {
  return [...messages].sort((a, b) => {
    const at = Date.parse(a.created_at);
    const bt = Date.parse(b.created_at);
    if (at !== bt) return at - bt;
    return a.id.localeCompare(b.id);
  });
}

/** The realtime row, shaped like a history row (the bubble contract). */
function messageFromRealtime(payload: RealtimeDmPayload): DmMessage {
  return {
    id: payload.id,
    content: payload.content ?? null,
    created_at: payload.created_at,
    user_id: payload.user_id,
    reply_to_id: payload.reply_to_id ?? null,
    image_url: payload.image_url ?? null,
    deleted_at: null,
    edited_at: null,
    users: payload.sender_name
      ? { name: payload.sender_name, avatar_url: payload.sender_avatar_url ?? null, designation: null }
      : null,
    reactions: [],
    reply_to: payload.reply_to_id
      ? {
          id: payload.reply_to_id,
          content: null,
          user_name: payload.reply_sender_name ?? '',
          user_id: payload.reply_sender_id ?? null,
        }
      : null,
    status: 'sent',
  };
}

export default function DmThreadScreen() {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const params = useLocalSearchParams<{
    id: string;
    name?: string;
    avatar?: string;
    peerId?: string;
  }>();
  const conversationId = params.id;
  const peerName = params.name ?? 'Member';
  const peerId = params.peerId ?? null;

  const [conversation, setConversation] = useState<DmConversation | null>(null);
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const messagesRef = useRef<DmMessage[]>([]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Cold start: paint the thread's last window from disk before the page
  // request answers (see lib/chatCache.ts). The fetch below merges over it.
  useEffect(() => {
    if (!userId || !conversationId) return undefined;
    let active = true;
    void chatCache.loadDmMessages(userId, conversationId).then((cached) => {
      if (!active || !cached || cached.length === 0) return;
      setMessages((current) => {
        const known = new Set(current.map((message) => message.id));
        const fresh = cached.filter((message) => !known.has(message.id));
        return fresh.length > 0 ? sortMessages([...current, ...fresh]) : current;
      });
    });
    return () => {
      active = false;
    };
  }, [conversationId, userId]);

  // Write-through: a relaunch reads this window back on mount, and edits /
  // deletes / reactions applied while open are reflected in it.
  useEffect(() => {
    if (!userId || !conversationId || messages.length === 0) return;
    void chatCache.saveDmMessages(userId, conversationId, messages);
  }, [conversationId, messages, userId]);

  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Measured for the iOS keyboard offset — the KAV starts below the header. */
  const [headerHeight, setHeaderHeight] = useState(0);

  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<DmMessage | null>(null);
  const [editingMessage, setEditingMessage] = useState<DmMessage | null>(null);
  const [imageIndex, setImageIndex] = useState<number | null>(null);
  const [emojiPanelOpen, setEmojiPanelOpen] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [answering, setAnswering] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The first-open unread marker — latched once, never recomputed on sends. */
  const [initialUnread, setInitialUnread] = useState<{ id: string; count: number } | null>(
    null,
  );
  /** The list stays hidden until the anchor scroll is committed (no top flash). */
  const [initialPositionResolved, setInitialPositionResolved] = useState(false);
  /** Row focus flash after a reply jump — cleared by its own timer. */
  const [flashMessageId, setFlashMessageId] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    },
    [],
  );

  const loadingMoreRef = useRef(false);
  const markReadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMarkedRef = useRef<string | null>(null);
  const lastMarkCallRef = useRef(0);
  const initialScrollDoneRef = useRef(false);
  const atBottomRef = useRef(true);
  const listRef = useRef<FlatList<ThreadRow>>(null);
  const rowsRef = useRef<ThreadRow[]>([]);
  const reactionIntentRef = useRef(new Map<string, ReactionIntent>());
  const catchUpDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { typingUsers, notifyTyping } = useDmTyping(conversationId ?? null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, 2_500);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  // ── Load: first page + the conversation row (or a synthesized empty one) ──
  const synthesizeConversation = useCallback(
    (): DmConversation | null => {
      if (!peerId) return null;
      return {
        id: conversationId,
        peer: { id: peerId, name: peerName, avatar_url: params.avatar || null },
        last_message: null,
        unread_count: 0,
        my_last_read_at: null,
        last_message_at: null,
        last_reaction: null,
        // A conversation kept out of the list has no message yet: the next
        // message becomes the request.
        request_state: 'pending',
        requested_by: null,
        blocked_by_me: false,
      };
    },
    [conversationId, params.avatar, peerId, peerName],
  );

  const load = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    setError(null);
    try {
      const [page, conversations] = await Promise.all([
        getDmMessages(conversationId),
        getDmConversations().catch(() => [] as DmConversation[]),
      ]);
      const found =
        conversations.find((row) => row.id === conversationId) ?? synthesizeConversation();
      // Merge over the cached/hydrated window: the server page wins row by
      // row (edits, deletes, reactions), while the older rows already on
      // screen stay reachable above it.
      setMessages((current) => {
        const byId = new Map(current.map((message) => [message.id, message]));
        for (const message of page.messages) byId.set(message.id, message);
        return sortMessages([...byId.values()]);
      });
      setHasMore(page.hasMore);
      setConversation(found);

      // Snapshot the unread boundary before this open marks everything read.
      setInitialUnread(null);
      if (found && found.unread_count > 0) {
        const firstUnread = page.messages.find(
          (message) =>
            message.user_id === found.peer.id &&
            (!found.my_last_read_at || message.created_at > found.my_last_read_at),
        );
        if (firstUnread) {
          setInitialUnread({ id: firstUnread.id, count: found.unread_count });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load this conversation.');
    } finally {
      setLoading(false);
    }
  }, [conversationId, synthesizeConversation]);

  useEffect(() => {
    void load();
  }, [load]);

  // While this thread is open the badge must not bump for its own messages.
  useEffect(() => {
    setDmActiveConversation(conversationId ?? null);
    return () => setDmActiveConversation(null);
  }, [conversationId]);

  // ── Send / edit / delete ──────────────────────────────────────────────────
  const scrollToLatest = useCallback((animated = true) => {
    listRef.current?.scrollToOffset({ offset: 0, animated });
  }, []);

  // Android's keyboard-controller resizes the screen; jump to the newest
  // message when it opens, exactly like the community chat (iOS is handled by
  // the KAV offset below).
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = KeyboardEvents.addListener('keyboardDidShow', () => {
      if (atBottomRef.current) scrollToLatest(true);
    });
    return () => subscription.remove();
  }, [scrollToLatest]);

  const {
    handleSend,
    handleCancel,
    handleRetry,
    handleEdit,
    handleDelete,
    sending,
    sendError,
    editSaving,
    editError,
    clearEditError,
  } = useDmSend({
    conversationId: conversationId ?? null,
    currentUser: {
      id: userId ?? '',
      name: user?.name ?? 'You',
      avatar_url: user?.avatar_url ?? null,
    },
    setMessages,
    scrollToLatest,
    stopTyping: () => notifyTyping(false),
    onConversationState: (state, requestedBy) => {
      setConversation((current) =>
        current
          ? { ...current, request_state: state, requested_by: requestedBy }
          : current,
      );
    },
  });

  // ── Read marking: newest real (non-temp) message, throttled ──────────────
  const markReadNow = useCallback(
    (force = false) => {
      if (!conversationId) return;
      const newest = newestMessageAt(
        messages.filter((message) => !message.id.startsWith('temp-')),
      );
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

  // ── Catch-up after a reconnect (missed events are recovered via ?after=) ──
  const catchUp = useCallback(async () => {
    if (!conversationId) return;
    try {
      const conversations = await getDmConversations().catch(() => [] as DmConversation[]);
      const found = conversations.find((row) => row.id === conversationId);
      if (found) setConversation(found);

      const current = messagesRef.current;
      const newestReal = [...current]
        .reverse()
        .find((message) => !message.id.startsWith('temp-'));

      if (!newestReal) {
        const page = await getDmMessages(conversationId);
        setMessages((existing) => {
          const seen = new Set(existing.map((message) => message.id));
          return sortMessages([
            ...existing,
            ...page.messages.filter((message) => !seen.has(message.id)),
          ]);
        });
        return;
      }

      const newer = await getDmMessagesAfter(conversationId, {
        createdAt: newestReal.created_at,
        id: newestReal.id,
      });
      if (newer.length === 0) return;
      setMessages((existing) => {
        const seen = new Set(existing.map((message) => message.id));
        return sortMessages([
          ...existing,
          ...newer.filter((message) => !seen.has(message.id)),
        ]);
      });
      if (atBottomRef.current) setTimeout(() => scrollToLatest(true), 40);
    } catch {
      /* the next reconnect or open retries */
    }
  }, [conversationId, scrollToLatest]);

  const scheduleCatchUp = useCallback(() => {
    if (catchUpDebounceRef.current) clearTimeout(catchUpDebounceRef.current);
    catchUpDebounceRef.current = setTimeout(() => {
      catchUpDebounceRef.current = null;
      void catchUp();
    }, CATCH_UP_DEBOUNCE_MS);
  }, [catchUp]);

  // ── Realtime: messages, requests, edits, deletes, reactions ───────────────
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
        const incoming = messageFromRealtime(payload);

        setMessages((current) => {
          if (current.some((message) => message.id === payload.id)) return current;

          // The echo confirms one of our optimistic bubbles (or replaced it).
          if (payload.user_id === userId) {
            const temp = current.find(
              (message) =>
                message.id.startsWith('temp-') &&
                message.user_id === userId &&
                message.status !== 'failed' &&
                (message.content ?? '') === (incoming.content ?? '') &&
                Boolean(message.image_url) === Boolean(incoming.image_url),
            );
            if (temp) {
              return sortMessages(
                current.map((message) =>
                  message.id === temp.id
                    ? {
                        ...incoming,
                        users: incoming.users ?? message.users,
                        reply_to: incoming.reply_to ?? message.reply_to,
                        status: 'sent' as const,
                      }
                    : message,
                ),
              );
            }
          }

          return sortMessages([...current, incoming]);
        });
        if (atBottomRef.current) setTimeout(() => scrollToLatest(true), 40);
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
                  edited_at: payload.edited_at ?? new Date().toISOString(),
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
                  reactions: [],
                }
              : message,
          ),
        );
      }),
    );

    unsubscribes.push(
      realtimeClient.on(room, 'dm-reaction-insert', (data) => {
        const payload = data as {
          conversation_id?: string;
          message_id?: string;
          user_id?: string;
          emoji?: string;
        } | null;
        if (
          !payload?.conversation_id ||
          payload.conversation_id !== conversationId ||
          !payload.message_id ||
          !payload.user_id ||
          !payload.emoji
        ) {
          return;
        }
        setMessages((current) =>
          current.map((message) =>
            message.id === payload.message_id
              ? {
                  ...message,
                  reactions: applyReactionInsert(
                    message.reactions ?? [],
                    payload.emoji!,
                    payload.user_id!,
                  ),
                }
              : message,
          ),
        );
      }),
    );

    unsubscribes.push(
      realtimeClient.on(room, 'dm-reaction-update', (data) => {
        const payload = data as {
          old?: { conversation_id?: string; message_id?: string; user_id?: string; emoji?: string };
          new?: { conversation_id?: string; message_id?: string; user_id?: string; emoji?: string };
        } | null;
        const next = payload?.new;
        const previous = payload?.old;
        if (
          !next?.conversation_id ||
          next.conversation_id !== conversationId ||
          !next.message_id ||
          !next.user_id ||
          !next.emoji
        ) {
          return;
        }
        setMessages((current) =>
          current.map((message) => {
            if (message.id !== next.message_id) return message;
            const removed =
              previous?.emoji && previous.user_id
                ? applyReactionDelete(message.reactions ?? [], previous.emoji, previous.user_id)
                : message.reactions ?? [];
            return {
              ...message,
              reactions: applyReactionInsert(removed, next.emoji!, next.user_id!),
            };
          }),
        );
      }),
    );

    unsubscribes.push(
      realtimeClient.on(room, 'dm-reaction-delete', (data) => {
        const payload = data as {
          conversation_id?: string;
          message_id?: string;
          user_id?: string;
          emoji?: string;
        } | null;
        if (
          !payload?.conversation_id ||
          payload.conversation_id !== conversationId ||
          !payload.message_id ||
          !payload.user_id ||
          !payload.emoji
        ) {
          return;
        }
        setMessages((current) =>
          current.map((message) =>
            message.id === payload.message_id
              ? {
                  ...message,
                  reactions: applyReactionDelete(
                    message.reactions ?? [],
                    payload.emoji!,
                    payload.user_id!,
                  ),
                }
              : message,
          ),
        );
      }),
    );

    const unsubscribeStatus = realtimeClient.onRoomStatus(room, (connected) => {
      if (connected) scheduleCatchUp();
    });

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      unsubscribeStatus();
      if (catchUpDebounceRef.current) {
        clearTimeout(catchUpDebounceRef.current);
        catchUpDebounceRef.current = null;
      }
    };
  }, [userId, user?.name, conversationId, scheduleCatchUp, scrollToLatest]);

  // ── Pagination (older pages) ──────────────────────────────────────────────
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
        return [
          ...page.messages.filter((message) => !seen.has(message.id)),
          ...current,
        ];
      });
      setHasMore(page.hasMore);
    } catch {
      // Keep the timeline; the next scroll retries.
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [conversationId, hasMore, messages]);

  // ── Reactions (optimistic, server-confirmed) ──────────────────────────────
  const handleReaction = useCallback(
    async (messageId: string, emoji: string) => {
      const currentUser = user?.id ?? '';
      const target = messagesRef.current.find((message) => message.id === messageId);
      if (!target || !currentUser || target.id.startsWith('temp-')) return;

      const previousReactions = target.reactions ?? [];
      const previous =
        reactionIntentRef.current.get(messageId) ??
        myReactionEmoji(previousReactions, currentUser);
      const desired = nextReactionIntent(previous, emoji);
      hapticToggle(desired !== null);

      reactionIntentRef.current.set(messageId, desired);
      setMessages((current) =>
        current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                reactions: projectOwnReaction(
                  message.reactions ?? [],
                  desired,
                  currentUser,
                ),
              }
            : message,
        ),
      );

      try {
        const { reactions } = await setDmMessageReaction(messageId, desired);
        reactionIntentRef.current.set(messageId, myReactionEmoji(reactions, currentUser));
        setMessages((current) =>
          current.map((message) =>
            message.id === messageId ? { ...message, reactions } : message,
          ),
        );
      } catch {
        reactionIntentRef.current.delete(messageId);
        setMessages((current) =>
          current.map((message) =>
            message.id === messageId
              ? { ...message, reactions: previousReactions }
              : message,
          ),
        );
      }
    },
    [user?.id],
  );

  // ── Actions from the long-press sheet ─────────────────────────────────────
  const handleReply = useCallback((message: DmMessage) => {
    if (message.id.startsWith('temp-')) return;
    setReplyTo({
      id: message.id,
      content: message.content || (message.image_url ? '📷 Image' : ''),
      user_name:
        message.users?.name ??
        (message.user_id === user?.id ? user?.name ?? 'You' : 'Unknown'),
      user_id: message.user_id,
    });
  }, [user?.id, user?.name]);

  const handleCopy = useCallback(() => {
    showToast('Copied');
  }, [showToast]);

  const handleSaveEdit = useCallback(
    async (messageId: string, content: string) => {
      if (!editingMessage || editingMessage.id !== messageId) return;
      const ok = await handleEdit(editingMessage, content);
      if (ok) setEditingMessage(null);
    },
    [editingMessage, handleEdit],
  );

  // ── Reply jump ────────────────────────────────────────────────────────────
  const handleReplyPress = useCallback(
    (messageId: string) => {
      const index = rowsRef.current.findIndex(
        (row) => row.kind === 'message' && row.msg.id === messageId,
      );
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

  // ── Rows: day dividers interleaved with the timeline ─────────────────────
  const rows = useMemo<ThreadRow[]>(() => {
    const out: ThreadRow[] = [];
    let currentDay: string | null = null;
    let previousUser: string | null = null;

    for (const message of messages) {
      const day = fmtDate(message.created_at);
      if (day !== currentDay) {
        out.push({ kind: 'date', key: `date-${day}-${out.length}`, label: day });
        currentDay = day;
        previousUser = null;
      }
      if (initialUnread && message.id === initialUnread.id) {
        out.push({
          kind: 'unread',
          key: `unread-${message.id}`,
          count: initialUnread.count,
        });
      }
      out.push({
        kind: 'message',
        key: message.id,
        msg: message,
        isSameAuthor: previousUser === message.user_id,
      });
      previousUser = message.user_id;
    }

    // The list is inverted; newest must sit at the bottom.
    return out.reverse();
  }, [messages, initialUnread]);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  // ── Initial position: the unread divider when there is one, newest
  // otherwise (the web's useDmScrollAndUnread anchor). One-shot — later
  // messages never move the reader.
  useEffect(() => {
    if (loading || error || initialScrollDoneRef.current) return;
    initialScrollDoneRef.current = true;

    if (messages.length === 0) {
      setInitialPositionResolved(true);
      return;
    }

    requestAnimationFrame(() => {
      if (initialUnread) {
        const index = rows.findIndex((row) => row.kind === 'unread');
        if (index >= 0) {
          listRef.current?.scrollToIndex({
            index,
            animated: false,
            viewPosition: 0.15,
          });
        } else {
          listRef.current?.scrollToOffset({ offset: 0, animated: false });
        }
      } else {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
      }
      // One more frame lets the native scroll commit before the list paints.
      requestAnimationFrame(() => setInitialPositionResolved(true));
    });
  }, [loading, error, initialUnread, messages.length, rows]);

  // ── Images / lightbox ─────────────────────────────────────────────────────
  const lightboxImages = useMemo<LightboxImage[]>(
    () =>
      messages
        .filter((message) => !!message.image_url && !message.deleted_at)
        .map((message) => ({
          url: message.image_url as string,
          content: message.content,
          user_name: message.users?.name ?? null,
          avatar_url: message.users?.avatar_url ?? null,
          created_at: message.created_at,
        })),
    [messages],
  );

  const handleImagePress = useCallback(
    (url: string) => {
      const index = lightboxImages.findIndex((image) => image.url === url);
      setImageIndex(index < 0 ? 0 : index);
    },
    [lightboxImages],
  );

  // ── Request answers + safety actions ──────────────────────────────────────
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
        showToast(e instanceof Error ? e.message : 'The answer could not be saved.');
      } finally {
        setAnswering(false);
      }
    },
    [answering, conversationId, showToast],
  );

  const handleBlock = useCallback(async () => {
    const target = conversation?.peer.id ?? peerId;
    if (!target || actionBusy) return;
    setMenuOpen(false);
    setActionBusy(true);
    try {
      await blockUser(target);
      setConversation((current) =>
        current ? { ...current, blocked_by_me: true } : current,
      );
      showToast('Member blocked');
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not block this member.');
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, conversation?.peer.id, peerId, showToast]);

  const handleUnblock = useCallback(async () => {
    const target = conversation?.peer.id ?? peerId;
    if (!target || actionBusy) return;
    setMenuOpen(false);
    setActionBusy(true);
    try {
      await unblockUser(target);
      setConversation((current) =>
        current ? { ...current, blocked_by_me: false } : current,
      );
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not unblock this member.');
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, conversation?.peer.id, peerId, showToast]);

  const openPeerProfile = useCallback(() => {
    const target = conversation?.peer.id ?? peerId;
    if (!target) return;
    hapticSelection();
    router.push({ pathname: '/member/[id]', params: { id: target } });
  }, [conversation?.peer.id, peerId, router]);

  // ── Composer state ────────────────────────────────────────────────────────
  const composerState = useMemo(
    () =>
      conversation && userId
        ? dmComposerState(conversation, userId)
        : ({ kind: 'ready' } as const),
    [conversation, userId],
  );
  /**
   * A cached thread paints before the conversation row lands, but the footer
   * must not: request/block state is unknown until then, and the ready
   * composer would let a reply bypass an unanswered message request.
   */
  const composerReady = !loading && !!conversation;
  const unstarted = conversation ? isUnstartedRequest(conversation) : false;
  const displayPeerName = conversation?.peer.name ?? peerName;
  const displayPeerAvatar = conversation?.peer.avatar_url ?? (params.avatar || null);

  const rejectedByMe =
    conversation?.request_state === 'rejected' && conversation.requested_by !== userId;

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={colors.isDark ? 'light' : 'dark'} />

      {/* Header — peer identity (opens their profile) + the ⋯ safety menu. */}
      <View
        onLayout={(event) => setHeaderHeight(event.nativeEvent.layout.height)}
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
          style={styles.headerIcon}
        >
          <Ionicons name="arrow-back" size={22} color={colors.foreground} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${displayPeerName} profile`}
          onPress={openPeerProfile}
          style={({ pressed }) => [
            styles.headerPeer,
            { opacity: pressed ? 0.75 : 1 },
          ]}
        >
          <PersonAvatar name={displayPeerName} url={displayPeerAvatar} size={36} />
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
            {displayPeerName}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Conversation options"
          hitSlop={8}
          onPress={() => {
            hapticSelection();
            setMenuOpen(true);
          }}
          style={styles.headerIcon}
        >
          <Feather name="more-vertical" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {loading && messages.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error && messages.length === 0 ? (
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
        <>
          <ThreadKeyboardView headerHeight={headerHeight}>
            <View style={styles.flex}>
            <FlatList
              ref={listRef}
              inverted
              data={rows}
              keyExtractor={(row) => row.key}
              // A cached window paints at once; the anchor runs when the page
              // request settles and may move it to the unread divider.
              style={{ opacity: initialPositionResolved || messages.length > 0 ? 1 : 0 }}
              contentContainerStyle={styles.list}
              keyboardDismissMode="on-drag"
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
              onScroll={(event) => {
                const next = event.nativeEvent.contentOffset.y <= 24;
                atBottomRef.current = next;
                setAtBottom((current) => (current === next ? current : next));
              }}
              scrollEventThrottle={32}
              onScrollBeginDrag={() => setEmojiPanelOpen(false)}
              onEndReached={() => void loadMore()}
              onEndReachedThreshold={0.3}
              onScrollToIndexFailed={(info) => {
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
                    /* the member can scroll */
                  }
                }, 120);
              }}
              renderItem={({ item }) => {
                if (item.kind === 'date') {
                  return (
                    <View style={styles.dateDivider}>
                      <Text
                        style={[
                          styles.datePill,
                          {
                            color: colors.mutedForeground,
                            backgroundColor: colors.surfaceRaised,
                          },
                        ]}
                      >
                        {item.label}
                      </Text>
                    </View>
                  );
                }
                if (item.kind === 'unread') {
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
                        {item.count} unread message{item.count === 1 ? '' : 's'}
                      </Text>
                      <View style={[styles.unreadLine, { backgroundColor: colors.border }]} />
                    </View>
                  );
                }
                return (
                  <MessageBubble
                    message={item.msg}
                    isOwn={item.msg.user_id === userId}
                    isSameAuthor={item.isSameAuthor}
                    currentUserId={userId ?? ''}
                    onLongPress={setSelectedMessage}
                    onReactionPress={(messageId, emoji) => void handleReaction(messageId, emoji)}
                    onAuthorPress={openPeerProfile}
                    onImagePress={handleImagePress}
                    onCancel={handleCancel}
                    onRetry={handleRetry}
                    onReplyPress={handleReplyPress}
                    onSwipeReply={handleReply}
                    highlighted={flashMessageId === item.msg.id}
                  />
                );
              }}
              ListFooterComponent={
                loadingMore ? (
                  <View style={styles.moreSpinner}>
                    <ActivityIndicator size="small" color={colors.foregroundMuted} />
                  </View>
                ) : null
              }
              ListEmptyComponent={
                <View style={styles.emptyThread}>
                  <PersonAvatar
                    name={displayPeerName}
                    url={displayPeerAvatar}
                    size={48}
                  />
                  <Text style={[styles.stateBody, { color: colors.foregroundMuted }]}>
                    Say hi to{' '}
                    <Text style={{ color: colors.foreground, fontFamily: 'Geist_500Medium' }}>
                      {displayPeerName}
                    </Text>
                    .
                  </Text>
                </View>
              }
            />

            {!atBottom && !loading ? (
              <Pressable
                onPress={() => scrollToLatest(true)}
                accessibilityLabel="Scroll to latest message"
                hitSlop={6}
                style={[
                  styles.jumpButton,
                  { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
                ]}
              >
                <Feather name="chevron-down" size={16} color={colors.mutedForeground} />
              </Pressable>
            ) : null}
          </View>

          <View
            style={[
              styles.footer,
              {
                borderTopColor: colors.border,
                backgroundColor: colors.background,
              },
            ]}
          >
            <TypingIndicator users={typingUsers} />

            {!composerReady ? null : composerState.kind === 'blocked' ? (
              <View style={styles.footerBar}>
                <Feather name="slash" size={15} color={colors.destructive} />
                <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
                  You blocked{' '}
                  <Text style={{ color: colors.foreground, fontFamily: 'Geist_500Medium' }}>
                    {displayPeerName}
                  </Text>
                  . They can&apos;t send you messages.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={actionBusy}
                  onPress={() => void handleUnblock()}
                  style={({ pressed }) => [
                    styles.footerChip,
                    { borderColor: colors.border, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[styles.footerChipText, { color: colors.foreground }]}>
                    {actionBusy ? 'Unblocking…' : 'Unblock'}
                  </Text>
                </Pressable>
              </View>
            ) : composerState.kind === 'incoming-request' ? (
              <View style={styles.footerBar}>
                <View style={styles.footerCopy}>
                  <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
                    <Text style={{ color: colors.foreground, fontFamily: 'Geist_500Medium' }}>
                      {displayPeerName}
                    </Text>{' '}
                    wants to message you. Accept to reply — or reject to close this request.
                  </Text>
                </View>
                <View style={styles.footerActions}>
                  <Pressable
                    accessibilityRole="button"
                    disabled={answering}
                    onPress={() => void answer('reject')}
                    style={({ pressed }) => [
                      styles.footerChip,
                      { borderColor: colors.borderStrong, opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <Text style={[styles.footerChipText, { color: colors.foreground }]}>
                      Reject
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    disabled={answering}
                    onPress={() => void answer('accept')}
                    style={({ pressed }) => [
                      styles.footerChip,
                      {
                        borderColor: colors.accent,
                        backgroundColor: colors.accent,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                  >
                    <Text
                      style={[styles.footerChipText, { color: colors.accentForeground }]}
                    >
                      Accept
                    </Text>
                  </Pressable>
                </View>
              </View>
            ) : composerState.kind === 'outgoing-request' ? (
              <View style={styles.footerInfo}>
                <Feather name="clock" size={15} color={colors.foregroundMuted} />
                <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
                  Message request sent —{' '}
                  <Text style={{ color: colors.foreground, fontFamily: 'Geist_500Medium' }}>
                    {displayPeerName}
                  </Text>{' '}
                  needs to accept before you can send more.
                </Text>
              </View>
            ) : composerState.kind === 'rejected' ? (
              <View style={styles.footerInfo}>
                <Feather name="x-circle" size={15} color={colors.foregroundMuted} />
                <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
                  {rejectedByMe
                    ? 'You rejected this message request.'
                    : "Your message request was declined — you can't send more messages here."}
                </Text>
              </View>
            ) : (
              <>
                {unstarted ? (
                  <View style={styles.preSendHint}>
                    <Feather name="info" size={12} color={colors.foregroundMuted} />
                    <Text style={[styles.preSendText, { color: colors.foregroundMuted }]}>
                      {requestHintForPeer(displayPeerName)}
                    </Text>
                  </View>
                ) : null}
                <DmComposer
                  replyTo={replyTo}
                  onCancelReply={() => setReplyTo(null)}
                  onSend={(text, pendingImage) => {
                    handleSend(text, pendingImage, replyTo);
                    setReplyTo(null);
                  }}
                  onTypingChange={(text) => notifyTyping(text.length > 0)}
                  disabled={unstarted && sending}
                  error={sendError}
                  emojiPanelOpen={emojiPanelOpen}
                  onEmojiPanelOpenChange={setEmojiPanelOpen}
                />
              </>
            )}
          </View>
          </ThreadKeyboardView>
          {/* The home-indicator strip below the composer, outside the KAV —
              the community chat lays it out the same way. */}
          <View style={{ height: insets.bottom, backgroundColor: colors.background }} />
        </>
      )}

      {toast ? (
        <View
          pointerEvents="none"
          style={[styles.toast, { backgroundColor: colors.foreground }]}
        >
          <Text style={[styles.toastText, { color: colors.background }]}>{toast}</Text>
        </View>
      ) : null}

      {/* Long-press actions — reactions, reply, copy, edit, delete */}
      <MessageActionsSheet
        message={selectedMessage}
        currentUserId={userId ?? ''}
        canModerate={false}
        onClose={() => setSelectedMessage(null)}
        onReact={(messageId, emoji) => void handleReaction(messageId, emoji)}
        onReply={handleReply}
        onCopy={handleCopy}
        onEdit={(message) => {
          if (message.id.startsWith('temp-')) return;
          clearEditError();
          setEditingMessage(message);
        }}
        onDelete={(messageId) => {
          const message = messagesRef.current.find((row) => row.id === messageId);
          if (message) void handleDelete(message);
        }}
      />

      <EditMessageModal
        message={editingMessage}
        isSaving={editSaving}
        error={editError}
        onClose={() => {
          clearEditError();
          setEditingMessage(null);
        }}
        onSave={(messageId, content) => void handleSaveEdit(messageId, content)}
      />

      {imageIndex !== null && lightboxImages.length > 0 ? (
        <ImageViewer
          images={lightboxImages}
          index={Math.min(imageIndex, lightboxImages.length - 1)}
          onClose={() => setImageIndex(null)}
          onNavigate={setImageIndex}
        />
      ) : null}

      <ThreadOptionsSheet
        visible={menuOpen}
        blockedByMe={conversation?.blocked_by_me ?? false}
        busy={actionBusy}
        onClose={() => setMenuOpen(false)}
        onReport={() => {
          setMenuOpen(false);
          // Let the sheet finish dismissing before the report modal presents —
          // iOS refuses a second presentation mid-dismissal.
          setTimeout(() => setReportOpen(true), 240);
        }}
        onBlock={() => void handleBlock()}
        onUnblock={() => void handleUnblock()}
      />

      <DmReportModal
        visible={reportOpen}
        conversationId={conversationId}
        peerName={displayPeerName}
        onClose={() => setReportOpen(false)}
      />
    </View>
  );
}

/**
 * Keyboard avoidance, wired exactly like the community chat: iOS uses the RN
 * KAV with the header's measured height as its offset (the KAV starts below
 * the header); Android uses keyboard-controller's height wrapper, since the
 * screen is resized rather than padded.
 */
function ThreadKeyboardView({
  headerHeight,
  children,
}: {
  headerHeight: number;
  children: React.ReactNode;
}) {
  if (Platform.OS === 'android') {
    return (
      <KeyboardControllerAvoidingView style={styles.flex} behavior="height">
        {children}
      </KeyboardControllerAvoidingView>
    );
  }
  return (
    <RNKeyboardAvoidingView
      style={styles.flex}
      behavior="padding"
      keyboardVerticalOffset={headerHeight}
    >
      {children}
    </RNKeyboardAvoidingView>
  );
}

/** Header ⋯ menu — Report, plus Block or Unblock depending on the state. */
function ThreadOptionsSheet({
  visible,
  blockedByMe,
  busy,
  onClose,
  onReport,
  onBlock,
  onUnblock,
}: {
  visible: boolean;
  blockedByMe: boolean;
  busy: boolean;
  onClose: () => void;
  onReport: () => void;
  onBlock: () => void;
  onUnblock: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}
          onPress={(event) => event.stopPropagation()}
        >
          <Pressable
            onPress={onReport}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.sheetRow,
              pressed && { backgroundColor: colors.surfaceRaised },
            ]}
          >
            <Feather name="flag" size={16} color={colors.mutedForeground} />
            <Text style={[styles.sheetLabel, { color: colors.foreground }]}>Report</Text>
          </Pressable>
          {blockedByMe ? (
            <Pressable
              onPress={onUnblock}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.sheetRow,
                pressed && { backgroundColor: colors.surfaceRaised },
              ]}
            >
              <Feather name="shield-off" size={16} color={colors.mutedForeground} />
              <Text style={[styles.sheetLabel, { color: colors.foreground }]}>
                {busy ? 'Unblocking…' : 'Unblock user'}
              </Text>
            </Pressable>
          ) : (
            <>
              <View style={[styles.sheetDivider, { backgroundColor: colors.border }]} />
              <Pressable
                onPress={onBlock}
                disabled={busy}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.sheetRow,
                  pressed && { backgroundColor: colors.destructive + '14' },
                ]}
              >
                <Feather name="slash" size={16} color={colors.destructive} />
                <Text style={[styles.sheetLabel, { color: colors.destructive }]}>
                  {busy ? 'Blocking…' : 'Block user'}
                </Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerIcon: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerPeer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minWidth: 0,
    paddingVertical: 2,
  },
  headerTitle: {
    fontFamily: 'Geist_600SemiBold',
    fontSize: 16,
    flexShrink: 1,
  },
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
  list: { paddingVertical: 12, flexGrow: 1 },
  dateDivider: { alignItems: 'center', paddingVertical: 10 },
  datePill: {
    fontFamily: 'Geist_500Medium',
    fontSize: 11,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  unreadDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 22,
    paddingVertical: 10,
  },
  unreadLine: { flex: 1, height: StyleSheet.hairlineWidth },
  unreadPill: {
    fontFamily: 'Geist_500Medium',
    fontSize: 10.5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  moreSpinner: { paddingVertical: 16, alignItems: 'center' },
  emptyThread: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 32,
  },
  jumpButton: {
    position: 'absolute',
    right: 16,
    bottom: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    flexWrap: 'wrap',
  },
  footerCopy: { flex: 1, minWidth: 160 },
  footerText: {
    fontFamily: 'Geist_400Regular',
    fontSize: 12.5,
    lineHeight: 18,
    flexShrink: 1,
  },
  footerActions: { flexDirection: 'row', gap: 8, marginLeft: 'auto' },
  footerChip: {
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerChipText: { fontFamily: 'Geist_600SemiBold', fontSize: 12.5 },
  footerInfo: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
  },
  preSendHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  preSendText: { fontFamily: 'Geist_400Regular', fontSize: 11, lineHeight: 15, flex: 1 },
  toast: {
    position: 'absolute',
    top: 96,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    zIndex: 30,
  },
  toastText: { fontFamily: 'Geist_500Medium', fontSize: 12.5 },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  sheetLabel: { fontFamily: 'Geist_500Medium', fontSize: 14.5 },
  sheetDivider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
});
