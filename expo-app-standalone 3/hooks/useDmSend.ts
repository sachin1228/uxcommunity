/**
 * Optimistic DM sends — the same contract as the community chat's
 * useSendMessage: a temp bubble appears immediately, images upload first, a
 * failed send stays tappable for retry, and every logical send keeps one
 * client nonce so a retry can never duplicate the row.
 *
 * Also owns edit and delete for the thread, reverting each optimistic paint if
 * the server rejects it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { PendingImage } from '@/components/chat/ChatInput';
import type { ReplyDraft } from '@/lib/chatContentEvents';
import type { DmMessage, DmRequestState } from '@/lib/dm';
import { uuidV4 } from '@/lib/dm';
import {
  deleteDmMessage,
  deleteDmUpload,
  editDmMessage,
  sendDmMessage,
  uploadDmImage,
} from '@/lib/dmApi';
import { chatKey, newClientNonce, optimisticMessageId } from '../../packages/offline-chat/src';
import {
  getOfflineChat,
  offlineRef,
  onOfflineChatChange,
} from '@/lib/offline/engine';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Options {
  conversationId: string | null;
  currentUser: { id: string; name: string; avatar_url: string | null };
  setMessages: Dispatch<SetStateAction<DmMessage[]>>;
  scrollToLatest: (animated?: boolean) => void;
  stopTyping: () => void;
  /** The post-send request lifecycle (the first message becomes the request). */
  onConversationState: (state: DmRequestState, requestedBy: string | null) => void;
}

interface RetryPayload {
  text: string;
  image: PendingImage | null;
  replyTo: ReplyDraft | null;
  nonce: string;
  uploadedUrl: string | null;
}

function sortMessages(messages: DmMessage[]): DmMessage[] {
  return [...messages].sort((a, b) => {
    const at = Date.parse(a.created_at);
    const bt = Date.parse(b.created_at);
    if (at !== bt) return at - bt;
    return a.id.localeCompare(b.id);
  });
}

function nextTempId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function useDmSend({
  conversationId,
  currentUser,
  setMessages,
  scrollToLatest,
  stopTyping,
  onConversationState,
}: Options) {
  const abortRefs = useRef<Map<string, AbortController>>(new Map());
  const retryDataRef = useRef<Map<string, RetryPayload>>(new Map());

  const [sendError, setSendError] = useState<string | null>(null);
  const [inFlight, setInFlight] = useState(0);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const clearSendError = useCallback(() => setSendError(null), []);

  // Durable send confirmations arrive through the controller (possibly after
  // the app was killed and reopened).
  useEffect(() => {
    if (!conversationId) return undefined;
    const key = chatKey(offlineRef('dm', conversationId));
    let unsubscribe: (() => void) | null = null;
    const attach = (engine: ReturnType<typeof getOfflineChat>) => {
      unsubscribe?.();
      unsubscribe = null;
      if (!engine) return;
      unsubscribe = engine.subscribe((event) => {
        if (event.type === 'connectivity') return;
        if (event.conversationKey !== key) return;
        if (event.type === 'message-sent') {
          const tempId = optimisticMessageId(event.clientNonce);
          const incoming = event.message.payload as unknown as DmMessage;
          setMessages((current) => {
            const optimistic = current.find((message) => message.id === tempId);
            const existing = current.find((message) => message.id === incoming.id);
            const merged: DmMessage = {
              ...(existing ?? optimistic ?? {}),
              ...incoming,
              users: incoming.users ?? existing?.users ?? optimistic?.users ?? null,
              reply_to: incoming.reply_to ?? existing?.reply_to ?? optimistic?.reply_to ?? null,
              image_url: incoming.image_url ?? existing?.image_url ?? optimistic?.image_url ?? null,
              status: 'sent',
              client_nonce: event.clientNonce,
            };
            const next = current.filter(
              (message) => message.id !== tempId && message.id !== incoming.id,
            );
            next.push(merged);
            return sortMessages(next);
          });
          const state = event.meta?.request_state;
          if (state === 'pending' || state === 'accepted' || state === 'rejected') {
            onConversationState(
              state,
              typeof event.meta?.requested_by === 'string'
                ? event.meta.requested_by
                : null,
            );
          }
          setSendError(null);
        } else if (event.type === 'message-failed') {
          setMessages((current) =>
            current.map((message) =>
              message.id === optimisticMessageId(event.clientNonce)
                ? { ...message, status: 'failed' }
                : message,
            ),
          );
          setSendError(event.error);
        }
      });
    };
    const stop = onOfflineChatChange(attach);
    return () => {
      stop();
      unsubscribe?.();
    };
  }, [conversationId, onConversationState, setMessages]);

  const removeMessage = useCallback(
    (messageId: string) => {
      setMessages((current) => current.filter((message) => message.id !== messageId));
    },
    [setMessages],
  );

  const runSend = useCallback(
    async (tempId: string, payload: RetryPayload) => {
      if (!conversationId) return;
      retryDataRef.current.set(tempId, payload);

      const controller = new AbortController();
      abortRefs.current.set(tempId, controller);

      try {
        let uploadedUrl = payload.uploadedUrl;
        if (payload.image && !uploadedUrl) {
          uploadedUrl = await uploadDmImage(conversationId, {
            uri: payload.image.uri,
            mimeType: payload.image.mimeType,
            name: `dm-image-${Date.now()}.${
              payload.image.mimeType.split('/')[1] ?? 'webp'
            }`,
          }, controller.signal);
          const entry = retryDataRef.current.get(tempId);
          if (entry) entry.uploadedUrl = uploadedUrl;
        }

        const result = await sendDmMessage(
          conversationId,
          {
            content: payload.text,
            imageUrl: uploadedUrl,
            replyToId: payload.replyTo?.id ?? null,
          },
          payload.nonce,
        );

        retryDataRef.current.delete(tempId);
        setMessages((current) => {
          const optimistic = current.find((message) => message.id === tempId);
          const existing = current.find((message) => message.id === result.message.id);
          const merged: DmMessage = {
            ...result.message,
            users: result.message.users ?? existing?.users ?? optimistic?.users ?? null,
            reply_to:
              result.message.reply_to ?? existing?.reply_to ?? optimistic?.reply_to ?? null,
            image_url:
              result.message.image_url ?? existing?.image_url ?? optimistic?.image_url ?? null,
            status: 'sent',
          };
          const next = current.filter(
            (message) => message.id !== tempId && message.id !== merged.id,
          );
          next.push(merged);
          return sortMessages(next);
        });
        onConversationState(result.requestState, result.requestedBy);
        setSendError(null);
        scrollToLatest(true);
      } catch (error) {
        if ((error as Error).name === 'AbortError') {
          // Text-only cancels vanish; an image bubble stays so it can be retried.
          if (payload.image) {
            setMessages((current) =>
              current.map((message) =>
                message.id === tempId ? { ...message, status: 'failed' } : message,
              ),
            );
          } else {
            removeMessage(tempId);
            retryDataRef.current.delete(tempId);
          }
          return;
        }
        setMessages((current) =>
          current.map((message) =>
            message.id === tempId ? { ...message, status: 'failed' } : message,
          ),
        );
        setSendError(error instanceof Error ? error.message : 'The message could not be sent.');
      } finally {
        abortRefs.current.delete(tempId);
      }
    },
    [conversationId, onConversationState, removeMessage, scrollToLatest, setMessages],
  );

  const handleSend = useCallback(
    (text: string, pendingImage?: PendingImage, replyTo?: ReplyDraft | null) => {
      const trimmed = text.trim();
      if ((!trimmed && !pendingImage) || !conversationId) return;

      stopTyping();
      setSendError(null);

      // ── Durable text path ────────────────────────────────────────────────
      const engine = getOfflineChat();
      if (engine && !pendingImage) {
        const nonce = newClientNonce();
        const tempId = optimisticMessageId(nonce);
        const optimistic: DmMessage = {
          id: tempId,
          content: trimmed || null,
          created_at: new Date().toISOString(),
          user_id: currentUser.id,
          reply_to_id: replyTo?.id ?? null,
          image_url: null,
          deleted_at: null,
          edited_at: null,
          users: {
            name: currentUser.name,
            avatar_url: currentUser.avatar_url,
            designation: null,
          },
          reactions: [],
          reply_to: replyTo
            ? {
                id: replyTo.id,
                content: replyTo.content,
                user_name: replyTo.user_name,
                user_id: replyTo.user_id,
              }
            : null,
          status: 'queued',
          client_nonce: nonce,
        };
        setMessages((current) => [...current, optimistic]);
        scrollToLatest(false);
        setSendError(null);
        void engine
          .enqueueText({
            ref: offlineRef('dm', conversationId),
            content: trimmed,
            replyToId: replyTo?.id ?? null,
            replyToContent: null,
            mentionUserIds: [],
            optimisticPayload: optimistic as unknown as Record<string, unknown>,
            clientNonce: nonce,
          })
          .catch(() => {
            setMessages((current) =>
              current.map((message) =>
                message.id === tempId ? { ...message, status: 'failed' } : message,
              ),
            );
            setSendError('Could not save this message on this device. Please try again.');
          });
        return;
      }

      const tempId = nextTempId();
      const now = new Date().toISOString();
      const optimistic: DmMessage = {
        id: tempId,
        content: trimmed || null,
        created_at: now,
        user_id: currentUser.id,
        reply_to_id: replyTo?.id ?? null,
        image_url: pendingImage?.uri ?? null,
        deleted_at: null,
        edited_at: null,
        users: {
          name: currentUser.name,
          avatar_url: currentUser.avatar_url,
          designation: null,
        },
        reactions: [],
        reply_to: replyTo
          ? {
              id: replyTo.id,
              content: replyTo.content,
              user_name: replyTo.user_name,
              user_id: replyTo.user_id,
            }
          : null,
        status: 'sending',
      };

      setMessages((current) => [...current, optimistic]);
      scrollToLatest(true);

      setInFlight((count) => count + 1);
      void runSend(tempId, {
        text: trimmed,
        image: pendingImage ?? null,
        replyTo: replyTo ?? null,
        nonce: uuidV4(),
        uploadedUrl: null,
      }).finally(() => {
        setInFlight((count) => Math.max(0, count - 1));
      });
    },
    [conversationId, currentUser, runSend, scrollToLatest, setMessages, stopTyping],
  );

  const handleCancel = useCallback((tempId: string) => {
    // A queued outbox row has no request to abort; removing its bubble here
    // would leave the queued message to send after the member dismissed it.
    if (
      !retryDataRef.current.has(tempId) &&
      UUID_RE.test(tempId.replace(/^temp-/, ''))
    ) {
      return;
    }
    const payload = retryDataRef.current.get(tempId);
    if (payload?.uploadedUrl && conversationId) {
      const url = payload.uploadedUrl;
      payload.uploadedUrl = null;
      void deleteDmUpload(conversationId, url).catch(() => {
        /* the sweep skips referenced assets; a repeat delete is a no-op */
      });
    }
    abortRefs.current.get(tempId)?.abort();
  }, [conversationId]);

  const handleRetry = useCallback(
    (tempId: string) => {
      const outboxNonce = tempId.startsWith('temp-')
        ? tempId.slice('temp-'.length)
        : '';
      const engine = getOfflineChat();
      if (engine && UUID_RE.test(outboxNonce)) {
        void engine.retry(outboxNonce).catch(() => undefined);
        return;
      }

      const payload = retryDataRef.current.get(tempId);
      if (!payload) return;
      removeMessage(tempId);
      retryDataRef.current.delete(tempId);
      const retryId = nextTempId();
      const optimistic: DmMessage = {
        id: retryId,
        content: payload.text || null,
        created_at: new Date().toISOString(),
        user_id: currentUser.id,
        reply_to_id: payload.replyTo?.id ?? null,
        image_url: payload.image?.uri ?? null,
        deleted_at: null,
        edited_at: null,
        users: {
          name: currentUser.name,
          avatar_url: currentUser.avatar_url,
          designation: null,
        },
        reactions: [],
        reply_to: payload.replyTo
          ? {
              id: payload.replyTo.id,
              content: payload.replyTo.content,
              user_name: payload.replyTo.user_name,
              user_id: payload.replyTo.user_id,
            }
          : null,
        status: 'sending',
      };
      setMessages((current) => [...current, optimistic]);
      setInFlight((count) => count + 1);
      void runSend(retryId, payload).finally(() => {
        setInFlight((count) => Math.max(0, count - 1));
      });
    },
    [currentUser, removeMessage, runSend, setMessages],
  );

  const handleEdit = useCallback(
    async (message: DmMessage, content: string): Promise<boolean> => {
      const trimmed = content.trim();
      if (!trimmed) {
        setEditError('Message cannot be empty.');
        return false;
      }
      if (!message.content) {
        setEditError('This message has no editable text.');
        return false;
      }

      const previous = message.content;
      setEditSaving(true);
      setEditError(null);
      setMessages((current) =>
        current.map((row) => (row.id === message.id ? { ...row, content: trimmed } : row)),
      );

      try {
        const saved = await editDmMessage(message.id, trimmed);
        setMessages((current) =>
          current.map((row) =>
            row.id === message.id
              ? { ...row, content: saved.content, edited_at: saved.edited_at }
              : row,
          ),
        );
        return true;
      } catch (error) {
        setMessages((current) =>
          current.map((row) =>
            row.id === message.id ? { ...row, content: previous } : row,
          ),
        );
        setEditError(error instanceof Error ? error.message : 'Failed to edit message.');
        return false;
      } finally {
        setEditSaving(false);
      }
    },
    [setMessages],
  );

  const handleDelete = useCallback(
    async (message: DmMessage) => {
      // A temp bubble has no server row — deleting it only discards the
      // optimistic copy (and any in-flight upload behind it).
      if (message.id.startsWith('temp-')) {
        abortRefs.current.get(message.id)?.abort();
        retryDataRef.current.delete(message.id);
        removeMessage(message.id);
        return;
      }

      const deletedAt = new Date().toISOString();
      setMessages((current) =>
        current.map((row) =>
          row.id === message.id
            ? {
                ...row,
                content: null,
                image_url: null,
                reply_to_id: null,
                reply_to: null,
                deleted_at: deletedAt,
                reactions: [],
              }
            : row,
        ),
      );
      try {
        await deleteDmMessage(message.id);
      } catch {
        setMessages((current) =>
          current.map((row) => (row.id === message.id ? message : row)),
        );
        setSendError('The message could not be deleted. Please try again.');
      }
    },
    [removeMessage, setMessages],
  );

  return {
    handleSend,
    handleCancel,
    handleRetry,
    handleEdit,
    handleDelete,
    /** True while at least one send is uploading/posting. */
    sending: inFlight > 0,
    sendError,
    clearSendError,
    editSaving,
    editError,
    clearEditError: () => setEditError(null),
  };
}
