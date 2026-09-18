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

import { useCallback, useRef, useState } from 'react';
import { Message, editMessage, uploadChatImage, sendMessage } from '@/lib/communities';
import { PendingImage } from '@/components/chat/ChatInput';
import type { MessageMention } from '@/lib/chat';

type RetryPayload = {
  text: string;
  pendingImage: PendingImage | null;
  replyTo: Message | null;
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
      replyTo: Message | null,
      mentions: MessageMention[]
    ) => {
      // Persist so retry can reconstruct the payload
      retryData.current.set(tempId, { text, pendingImage, replyTo, mentions });

      // Insert optimistic bubble immediately
      const optimistic: Message = {
        id: tempId,
        content: text || null,
        created_at: new Date().toISOString(),
        user_id: currentUser.id,
        reply_to_id: replyTo?.id ?? null,
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
              user_name: replyTo.users?.name ?? 'Unknown',
              user_id: replyTo.user_id,
            }
          : null,
        image_url: pendingImage?.uri ?? null,
        deleted_at: null,
        mentions,
        status: 'sending',
      };

      setMessages((prev) => {
        if (prev.some((m) => m.id === tempId)) return prev;
        return [...prev, optimistic];
      });
      scrollToLatest(true);

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
            reply_to_id: replyTo?.id,
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
      replyTo: Message | null,
      mentions: MessageMention[] = [],
    ) => {
      if (!text.trim() && !pendingImage) return;
      stopTyping();
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      runSend(tempId, text, pendingImage ?? null, replyTo, mentions);
    },
    [stopTyping, runSend]
  );

  /** Abort the in-flight upload/send for this bubble. */
  const handleCancel = useCallback((tempId: string) => {
    abortRefs.current.get(tempId)?.abort();
  }, []);

  /** Re-run the full send flow for a failed bubble. */
  const handleRetry = useCallback(
    (tempId: string) => {
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
