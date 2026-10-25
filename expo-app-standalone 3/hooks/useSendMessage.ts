/**
 * Optimistic send hook — mirrors the web useSendMessage UX:
 *
 *   1. Message bubble appears immediately with status "sending" and the local
 *      image URI as preview.
 *   2. While uploading, a cancel button is shown on the bubble.
 *   3. On cancel / network error → status becomes "failed"; the bubble stays
 *      so the user can tap Retry.
 *   4. On success → tempId is replaced with the real server message.
 *   5. Editing an owned message PATCHes it and stamps `edited_at` locally.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Message, editMessage, uploadChatImage, sendMessage } from '@/lib/communities';
import { PendingImage } from '@/components/chat/ChatInput';
import type { MessageMention } from '@/lib/chat';
import type { ReplyDraft } from '@/lib/chatContentEvents';
import { chatKey, newClientNonce, optimisticMessageId } from '../../packages/offline-chat/src';
import {
  getOfflineChat,
  offlineRef,
  onOfflineChatChange,
} from '@/lib/offline/engine';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RetryPayload = {
  text: string;
  pendingImage: PendingImage | null;
  replyTo: ReplyDraft | null;
  mentions: MessageMention[];
};

interface Options {
  communityId: string;
  currentUser: {
    id: string;
    name: string;
    avatar_url: string | null;
  };
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  scrollToLatest: (animated?: boolean) => void;
  stopTyping: () => void;
}

export function useSendMessage({
  communityId,
  currentUser,
  setMessages,
  scrollToLatest,
  stopTyping,
}: Options) {
  // In-flight AbortControllers keyed by tempId
  const abortRefs = useRef<Map<string, AbortController>>(new Map());
  // Retry payloads keyed by tempId (kept even after failure for retry)
  const retryData = useRef<Map<string, RetryPayload>>(new Map());

  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Confirmations for queued text sends arrive later (possibly after a
  // restart), so the bubble listens for them instead of awaiting a request.
  useEffect(() => {
    const key = chatKey(offlineRef('community', communityId));
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
          const incoming = event.message.payload as unknown as Message;
          setMessages((prev) => {
            const optimistic = prev.find((message) => message.id === tempId);
            const existing = prev.find((message) => message.id === incoming.id);
            const merged: Message = {
              ...(existing ?? optimistic ?? {}),
              ...incoming,
              users: incoming.users ?? existing?.users ?? optimistic?.users ?? null,
              reply_to: incoming.reply_to ?? existing?.reply_to ?? optimistic?.reply_to ?? null,
              reply_to_content:
                incoming.reply_to_content ?? existing?.reply_to_content ?? optimistic?.reply_to_content ?? null,
              image_url: incoming.image_url ?? existing?.image_url ?? optimistic?.image_url ?? null,
              mentions: incoming.mentions ?? existing?.mentions ?? optimistic?.mentions ?? null,
              status: 'sent',
              client_nonce: event.clientNonce,
            };
            const next = prev.filter(
              (message) => message.id !== tempId && message.id !== incoming.id,
            );
            next.push(merged);
            next.sort((a, b) => {
              const at = Date.parse(a.created_at);
              const bt = Date.parse(b.created_at);
              return at !== bt ? at - bt : a.id.localeCompare(b.id);
            });
            return next;
          });
        } else if (event.type === 'message-failed') {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === optimisticMessageId(event.clientNonce)
                ? { ...message, status: 'failed' }
                : message,
            ),
          );
        }
      });
    };
    const stop = onOfflineChatChange(attach);
    return () => {
      stop();
      unsubscribe?.();
    };
  }, [communityId, setMessages]);

  // ── private helpers ────────────────────────────────────────────────────────

  const upsertMsg = useCallback(
    (tempId: string, patch: Partial<Message> & Pick<Message, 'id'>) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === tempId ? { ...m, ...patch } : m))
      );
    },
    [setMessages]
  );

  const removeMsg = useCallback(
    (tempId: string) => {
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
    },
    [setMessages]
  );

  // ── core send flow ─────────────────────────────────────────────────────────

  const runSend = useCallback(
    async (
      tempId: string,
      text: string,
      pendingImage: PendingImage | null,
      replyTo: ReplyDraft | null,
      mentions: MessageMention[]
    ) => {
      // Persist so retry can reconstruct the payload
      retryData.current.set(tempId, { text, pendingImage, replyTo, mentions });

      // A content-anchored reply carries the card preview instead of a message
      // quote; the anchors are mutually exclusive (see the send payload below).
      const replyToContent = replyTo?.content_kind
        ? { id: replyTo.id, kind: replyTo.content_kind, title: replyTo.content }
        : null;

      // Insert optimistic bubble immediately
      const optimistic: Message = {
        id: tempId,
        content: text || null,
        created_at: new Date().toISOString(),
        user_id: currentUser.id,
        reply_to_id: replyToContent ? null : replyTo?.id ?? null,
        users: {
          name: currentUser.name,
          avatar_url: currentUser.avatar_url,
          designation: null,
        },
        reactions: [],
        reply_to:
          replyTo && !replyToContent
            ? {
                id: replyTo.id,
                content: replyTo.content,
                user_name: replyTo.user_name,
                user_id: replyTo.user_id,
              }
            : null,
        reply_to_content: replyToContent,
        image_url: pendingImage?.uri ?? null,
        deleted_at: null,
        mentions,
        status: 'sending',
      };

      setMessages((prev) => {
        if (prev.some((m) => m.id === tempId)) return prev;
        return [...prev, optimistic];
      });
      // Web parity: the send jump is instant (`scrollTop = max`, no smooth —
      // useSendMessage) and absolute, so the optimistic row lands at the
      // bottom without waiting for its height to be measured. A send from up
      // in history teleports down, exactly like the web.
      scrollToLatest(false);

      // Abort controller for this send
      const ctrl = new AbortController();
      abortRefs.current.set(tempId, ctrl);

      try {
        // ── upload image ──
        let imageUrl: string | undefined;
        if (pendingImage) {
          imageUrl = await uploadChatImage(
            communityId,
            pendingImage.uri,
            pendingImage.mimeType,
            ctrl.signal
          );
        }

        // ── send message ──
        const msg = await sendMessage(
          communityId,
          {
            content: text || undefined,
            // Message replies and content replies are mutually exclusive: a
            // content reply's id is a thread/showcase/resource/event id, not a
            // message id — sending it as reply_to_id would make the API try
            // (and fail) to validate it as a message and drop the anchor.
            reply_to_id: replyToContent ? undefined : replyTo?.id,
            reply_to_content: replyToContent
              ? { id: replyToContent.id, kind: replyToContent.kind }
              : undefined,
            image_url: imageUrl,
            mentions: mentions.length ? mentions : undefined,
          },
          ctrl.signal
        );

        // ── merge into list ──
        setMessages((prev) => {
          const opt = prev.find((m) => m.id === tempId);
          const merged: Message = {
            ...(opt ?? {}),
            ...msg,
            users: msg.users ?? opt?.users ?? null,
            reply_to: msg.reply_to ?? opt?.reply_to ?? null,
            reply_to_content: msg.reply_to_content ?? opt?.reply_to_content ?? null,
            image_url: msg.image_url ?? opt?.image_url ?? null,
            mentions: msg.mentions ?? opt?.mentions ?? null,
            status: 'sent',
          };

          // Realtime may have already inserted the real row (fan-out echoes the
          // message back before the POST response lands).
          if (prev.some((m) => m.id === msg.id)) {
            return prev
              .filter((m) => m.id !== tempId)
              .map((m) => (m.id === msg.id ? merged : m));
          }
          return prev.map((m) => (m.id === tempId ? merged : m));
        });

        retryData.current.delete(tempId);
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          // Cancelled by user
          if (pendingImage) {
            // Image was in flight — keep bubble as "failed" so they can retry
            upsertMsg(tempId, { id: tempId, status: 'failed' });
          } else {
            // Text-only cancel — remove bubble immediately
            removeMsg(tempId);
            retryData.current.delete(tempId);
          }
          return;
        }

        // Network or server error
        upsertMsg(tempId, { id: tempId, status: 'failed' });
        // Don't delete retryData — user may tap Retry
      } finally {
        abortRefs.current.delete(tempId);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [communityId, currentUser, setMessages, scrollToLatest, upsertMsg, removeMsg]
  );

  // ── public API ─────────────────────────────────────────────────────────────

  const handleSend = useCallback(
    (
      text: string,
      pendingImage: PendingImage | undefined,
      replyTo: ReplyDraft | null,
      mentions: MessageMention[] = [],
    ) => {
      if (!text.trim() && !pendingImage) return;
      stopTyping();

      // ── Durable text path ───────────────────────────────────────────────
      // Text-only sends are written with their outbox record before any
      // network call. Online and offline share the path, so a lost response or
      // a killed app retries the SAME nonce and the server dedupes it.
      const engine = getOfflineChat();
      if (engine && !pendingImage) {
        const nonce = newClientNonce();
        const tempId = optimisticMessageId(nonce);
        const replyToContent = replyTo?.content_kind
          ? { id: replyTo.id, kind: replyTo.content_kind }
          : null;
        const optimistic: Message = {
          id: tempId,
          content: text || null,
          created_at: new Date().toISOString(),
          user_id: currentUser.id,
          reply_to_id: replyToContent ? null : replyTo?.id ?? null,
          users: {
            name: currentUser.name,
            avatar_url: currentUser.avatar_url,
            designation: null,
          },
          reactions: [],
          reply_to:
            replyTo && !replyToContent
              ? {
                  id: replyTo.id,
                  content: replyTo.content,
                  user_name: replyTo.user_name,
                  user_id: replyTo.user_id,
                }
              : null,
          reply_to_content: replyToContent
            ? {
                id: replyToContent.id,
                kind: replyToContent.kind,
                title: replyTo?.content ?? '',
              }
            : null,
          image_url: null,
          deleted_at: null,
          mentions,
          status: 'queued',
          client_nonce: nonce,
        };

        setMessages((prev) => {
          if (prev.some((message) => message.id === tempId)) return prev;
          return [...prev, optimistic];
        });
        scrollToLatest(false);

        void engine
          .enqueueText({
            ref: offlineRef('community', communityId),
            content: text,
            replyToId: replyToContent ? null : replyTo?.id ?? null,
            replyToContent,
            mentionUserIds: mentions.map((mention) => mention.user_id),
            optimisticPayload: optimistic as unknown as Record<string, unknown>,
            clientNonce: nonce,
          })
          .catch(() => {
            setMessages((prev) =>
              prev.map((message) =>
                message.id === tempId ? { ...message, status: 'failed' } : message,
              ),
            );
          });
        return;
      }

      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      runSend(tempId, text, pendingImage ?? null, replyTo, mentions);
    },
    [stopTyping, runSend]
  );

  /** Abort the in-flight upload/send for this bubble. */
  const handleCancel = useCallback((tempId: string) => {
    // A queued outbox row has no request to abort; removing it here would
    // leave the message to send after the member dismissed it.
    if (
      !retryData.current.has(tempId) &&
      UUID_RE.test(tempId.replace(/^temp-/, ''))
    ) {
      return;
    }
    abortRefs.current.get(tempId)?.abort();
  }, []);

  /** Re-run the full send flow for a failed bubble. */
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

      const payload = retryData.current.get(tempId);
      if (!payload) return;

      // Remove the failed bubble before re-queueing
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      retryData.current.delete(tempId);

      const newTempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      runSend(newTempId, payload.text, payload.pendingImage, payload.replyTo, payload.mentions);
    },
    [setMessages, runSend]
  );

  /**
   * PATCH an owned message's text. Resolves true when the edit was accepted so
   * the caller can close its editor; the realtime `message-edit` event then
   * reconciles every other client.
   */
  const handleEdit = useCallback(
    async (messageId: string, content: string): Promise<boolean> => {
      const trimmed = content.trim();
      if (!trimmed) {
        setEditError('Message cannot be empty.');
        return false;
      }

      setEditSaving(true);
      setEditError(null);
      try {
        const { edited_at } = await editMessage(communityId, messageId, trimmed);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, content: trimmed, edited_at } : m,
          ),
        );
        return true;
      } catch (err) {
        setEditError(err instanceof Error ? err.message : 'Failed to edit message.');
        return false;
      } finally {
        setEditSaving(false);
      }
    },
    [communityId, setMessages],
  );

  const clearEditError = useCallback(() => setEditError(null), []);

  return {
    handleSend,
    handleCancel,
    handleRetry,
    handleEdit,
    editSaving,
    editError,
    clearEditError,
  };
}
