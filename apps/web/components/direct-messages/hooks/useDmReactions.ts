"use client";

import { useCallback, useEffect, useRef } from "react";
import { applyReactionDelete, applyReactionInsert } from "@/lib/communities/cache";
import { ReactionIntentCoordinator, trackReactionIntent, type ReactionIntent } from "@/lib/reaction-intent-coordinator";
import { dmUrls } from "@/lib/direct-messages/client";
import { dmCache, patchConversationReaction } from "@/lib/direct-messages/client-cache";
import { reactionPreviewText } from "@/lib/direct-messages/preview-text";
import type { DmConversationSummary, DmMessage } from "@/lib/direct-messages/types";
import type { MessageReaction } from "@/lib/communities/cache";

type ReactionResponse = { reactions: MessageReaction[]; currentUserEmoji: ReactionIntent };

async function persistReaction(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Unable to update reaction");
  const data = (await res.json()) as ReactionResponse;
  return { value: data.currentUserEmoji, data: data.reactions };
}

/**
 * Optimistic one-reaction-per-user toggles for DM messages — the community
 * chat's coordinator pattern, scoped per conversation instead of per room.
 */
export function useDmReactions({
  conversationId,
  currentUserId,
  setMessages,
  setConversations,
}: {
  conversationId: string | null;
  currentUserId: string;
  setMessages: (next: DmMessage[] | ((current: DmMessage[]) => DmMessage[])) => void;
  /** The list's state setter — the row's reaction preview is painted here. */
  setConversations: (
    next:
      | DmConversationSummary[]
      | ((current: DmConversationSummary[]) => DmConversationSummary[]),
  ) => void;
}) {
  const coordinatorsRef = useRef(new Map<string, ReactionIntentCoordinator<MessageReaction[]>>());

  useEffect(() => {
    const coordinators = coordinatorsRef.current;
    return () => {
      for (const coordinator of coordinators.values()) coordinator.dispose();
      coordinators.clear();
    };
  }, [conversationId]);

  const handleReactionToggled = useCallback(
    (msgId: string, reactions: MessageReaction[]) => {
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, reactions } : m)));
    },
    [setMessages],
  );

  const projectOwnReaction = useCallback(
    (reactions: MessageReaction[], desiredEmoji: ReactionIntent) => {
      const currentEmoji = reactions.find((reaction) => reaction.user_ids.includes(currentUserId))?.emoji;
      const withoutCurrent = currentEmoji
        ? applyReactionDelete(reactions, currentEmoji, currentUserId)
        : reactions;
      return desiredEmoji
        ? applyReactionInsert(withoutCurrent, desiredEmoji, currentUserId)
        : withoutCurrent;
    },
    [currentUserId],
  );

  const handleReaction = useCallback(
    (msgId: string, emoji: string) => {
      const targetConversationId = conversationId;
      if (!targetConversationId) return;
      const message = (dmCache.getMessages(targetConversationId) ?? []).find((item) => item.id === msgId);
      if (!message) return;

      const preview = reactionPreviewText({
        content: message.content,
        hasImage: Boolean(message.image_url),
      });

      /**
       * Paint the reaction on the conversation ROW in the same frame as the
       * bubble — the community sidebar's `patchSidebarReaction`. The own-
       * reaction realtime echo is suppressed (see the intent coordinator), so
       * without this the row only caught up on a full page refetch.
       */
      const paintRow = (desiredEmoji: ReactionIntent) => {
        setConversations((prev) =>
          patchConversationReaction(prev, {
            conversationId: targetConversationId,
            lastReaction:
              desiredEmoji === null
                ? null
                : {
                    messageId: msgId,
                    reactorId: currentUserId,
                    emoji: desiredEmoji,
                    createdAt: new Date().toISOString(),
                    firstName: "You",
                    isOwn: true,
                    messagePreview: preview.text,
                    messagePreviewMedia: preview.media,
                  },
          }),
        );
      };

      let coordinator = coordinatorsRef.current.get(msgId);
      if (!coordinator) {
        const initialEmoji =
          message.reactions?.find((reaction) => reaction.user_ids.includes(currentUserId))?.emoji ?? null;

        coordinator = new ReactionIntentCoordinator<MessageReaction[]>({
          initialValue: initialEmoji,
          onOptimisticChange: (desiredEmoji) => {
            const latest = (dmCache.getMessages(targetConversationId) ?? []).find((item) => item.id === msgId);
            if (latest) {
              handleReactionToggled(msgId, projectOwnReaction(latest.reactions ?? [], desiredEmoji));
            }
            paintRow(desiredEmoji);
          },
          onIntentChange: (value, pending) => {
            trackReactionIntent(targetConversationId, msgId, currentUserId, value, pending);
          },
          persist: (desiredEmoji) =>
            persistReaction(dmUrls.messageReactions(msgId), { desiredEmoji }),
          onConfirmed: ({ value, data }) => {
            handleReactionToggled(msgId, data);
            const latest = (dmCache.getMessages(targetConversationId) ?? []).find((item) => item.id === msgId);
            if (latest) {
              handleReactionToggled(msgId, projectOwnReaction(latest.reactions ?? [], value));
            }
            // The HTTP response is authoritative — repaint the row from it the
            // way the community hook repaints its sidebar on confirmation.
            paintRow(value);
          },
        });
        coordinatorsRef.current.set(msgId, coordinator);
      }

      coordinator.toggle(emoji);
    },
    [conversationId, currentUserId, handleReactionToggled, projectOwnReaction, setConversations],
  );

  return { handleReaction };
}
