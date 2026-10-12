"use client";

import { useCallback, useEffect, useRef } from "react";
import { applyReactionDelete, applyReactionInsert } from "@/lib/communities/cache";
import { ReactionIntentCoordinator, trackReactionIntent, type ReactionIntent } from "@/lib/reaction-intent-coordinator";
import { dmUrls } from "@/lib/direct-messages/client";
import { dmCache } from "@/lib/direct-messages/client-cache";
import type { DmMessage } from "@/lib/direct-messages/types";
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
}: {
  conversationId: string | null;
  currentUserId: string;
  setMessages: (next: DmMessage[] | ((current: DmMessage[]) => DmMessage[])) => void;
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
          },
        });
        coordinatorsRef.current.set(msgId, coordinator);
      }

      coordinator.toggle(emoji);
    },
    [conversationId, currentUserId, handleReactionToggled, projectOwnReaction],
  );

  return { handleReaction };
}
