/**
 * Optimistic send hook — mirrors the web useSendMessage UX:
 *
 *   1. Message bubble appears immediately with status "sending" and the local
 *      image URI as preview.
 *   2. While uploading, a cancel button is shown on the bubble.
 *   3. On cancel / network error → status becomes "failed"; the bubble stays
 *      so the user can tap Retry.
 *   4. On success → tempId is replaced with the real server message.
 */

import { useCallback, useRef } from 'react';
import { Message, uploadChatImage, sendMessage } from '@/lib/communities';
import { PendingImage } from '@/components/chat/ChatInput';

type RetryPayload = {
  text: string;
  pendingImage: PendingImage | null;
  replyTo: Message | null;
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
      replyTo: Message | null
    ) => {
      // Persist so retry can reconstruct the payload
      retryData.current.set(tempId, { text, pendingImage, replyTo });

      // Insert optimistic bubble immediately
      const optimistic: Message = {
        id: tempId,
        content: text || null,
        created_at: new Date().toISOString(),
        user_id: currentUser.id,
        users: {
          name: currentUser.name,
          avatar_url: currentUser.avatar_url,
          designation: null,
          company: null,
        },
        reactions: [],
        reply_to: replyTo
          ? {
              id: replyTo.id,
              content: replyTo.content,
              user_name: replyTo.users?.name ?? 'Unknown',
            }
          : null,
        image_url: pendingImage?.uri ?? null,
        deleted_at: null,
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
            status: 'sent',
          };

          // Realtime may have already inserted the real row
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
    (text: string, pendingImage: PendingImage | undefined, replyTo: Message | null) => {
      if (!text.trim() && !pendingImage) return;
      stopTyping();
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      runSend(tempId, text, pendingImage ?? null, replyTo);
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
      runSend(newTempId, payload.text, payload.pendingImage, payload.replyTo);
    },
    [setMessages, runSend]
  );

  return { handleSend, handleCancel, handleRetry };
}
