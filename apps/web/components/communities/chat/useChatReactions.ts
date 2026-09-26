"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  applyReactionDelete,
  applyReactionInsert,
  markSidebarReactionRemoved,
  msgCache,
  patchSidebarReaction,
  type CachedContentEvent,
  type CachedMessage,
  type MessageReaction,
} from "@/lib/communities/cache";
import {
  clearReactionIntentsForCommunity,
  ReactionIntentCoordinator,
  trackReactionIntent,
  type ReactionIntent,
} from "@/lib/reaction-intent-coordinator";

type ReactionResponse = { reactions: MessageReaction[]; currentUserEmoji: ReactionIntent };

function quotePreview(text: string): string {
  return `"${text.slice(0, 40)}${text.length > 40 ? "…" : ""}"`;
}

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
 * Optimistic one-reaction-per-user toggles for chat messages and for the
 * "created a …" notification cards. Each target gets its own
 * ReactionIntentCoordinator so rapid taps collapse into one persisted intent;
 * the sidebar preview line is patched in the same frame as the bubble.
 */
export function useChatReactions({
  communityId,
  currentUserId,
  setMessages,
  applyContentReactions,
}: {
  communityId: string;
  currentUserId: string;
  setMessages: React.Dispatch<React.SetStateAction<CachedMessage[]>>;
  applyContentReactions: (contentId: string, reactions: MessageReaction[]) => void;
}) {
  const handleReactionToggled = useCallback(
    (msgId: string, reactions: MessageReaction[]) => {
      setMessages((prev) => {
        const next = prev.map((m) => m.id === msgId ? { ...m, reactions } : m);
        msgCache.set(communityId, next);
        return next;
      });
    },
    [communityId, setMessages],
  );

  const projectOwnReaction = useCallback(
    (reactions: MessageReaction[], desiredEmoji: ReactionIntent) => {
      const currentEmoji = reactions.find((reaction) =>
        reaction.user_ids.includes(currentUserId),
      )?.emoji;
      const withoutCurrent = currentEmoji
        ? applyReactionDelete(reactions, currentEmoji, currentUserId)
        : reactions;
      return desiredEmoji
        ? applyReactionInsert(withoutCurrent, desiredEmoji, currentUserId)
        : withoutCurrent;
    },
    [currentUserId],
  );

  const messageCoordinatorsRef = useRef(new Map<string, ReactionIntentCoordinator<MessageReaction[]>>());
  const contentCoordinatorsRef = useRef(new Map<string, ReactionIntentCoordinator<MessageReaction[]>>());

  useEffect(() => {
    const coordinators = messageCoordinatorsRef.current;
    return () => {
      for (const coordinator of coordinators.values()) coordinator.dispose();
      coordinators.clear();
      clearReactionIntentsForCommunity(communityId);
    };
  }, [communityId]);

  useEffect(() => {
    const coordinators = contentCoordinatorsRef.current;
    return () => {
      for (const coordinator of coordinators.values()) coordinator.dispose();
      coordinators.clear();
    };
  }, []);

  const handleReaction = useCallback(
    (msgId: string, emoji: string) => {
      const message = msgCache.get(communityId)?.find((item) => item.id === msgId);
      if (!message) return;

      let coordinator = messageCoordinatorsRef.current.get(msgId);
      if (!coordinator) {
        const initialEmoji = message.reactions?.find((reaction) =>
          reaction.user_ids.includes(currentUserId),
        )?.emoji ?? null;
        const messagePreview = message.content
          ? quotePreview(message.content)
          : message.image_url
            ? "📷 Photo"
            : "a message";

        const paintIntent = (desiredEmoji: ReactionIntent) => {
          const latest = msgCache.get(communityId)?.find((item) => item.id === msgId);
          if (latest) {
            handleReactionToggled(msgId, projectOwnReaction(latest.reactions ?? [], desiredEmoji));
          }
          if (desiredEmoji === null) markSidebarReactionRemoved(communityId, msgId);
          patchSidebarReaction(
            communityId,
            desiredEmoji === null
              ? null
              : {
                  messageId: msgId,
                  emoji: desiredEmoji,
                  createdAt: new Date().toISOString(),
                  firstName: "You",
                  isOwn: true,
                  messagePreview,
                },
          );
        };

        coordinator = new ReactionIntentCoordinator<MessageReaction[]>({
          initialValue: initialEmoji,
          onOptimisticChange: paintIntent,
          onIntentChange: (value, pending) => {
            trackReactionIntent(communityId, msgId, currentUserId, value, pending);
          },
          persist: (desiredEmoji) =>
            persistReaction(`/api/communities/${communityId}/messages/${msgId}/reactions`, { desiredEmoji }),
          onConfirmed: ({ value, data }) => {
            handleReactionToggled(msgId, data);
            paintIntent(value);
          },
        });
        messageCoordinatorsRef.current.set(msgId, coordinator);
      }

      coordinator.toggle(emoji);
    },
    [communityId, currentUserId, handleReactionToggled, projectOwnReaction],
  );

  const handleContentReaction = useCallback(
    (event: CachedContentEvent, emoji: string) => {
      const contentId = event.id;
      const kind = event.kind;

      // The sidebar confirms the reaction in the same frame, exactly like a
      // message reaction — previewing the card's title ("You reacted 🔥 to:
      // \"ui vs ux\""). Only a newer message takes that line back, so the patch
      // survives the refetch that follows.
      const cardTitle = (event.title || "").split("\n")[0].trim();
      const contentPreview = cardTitle
        ? quotePreview(cardTitle)
        : `${/^[aeiou]/i.test(kind) ? "an" : "a"} ${kind}`;

      const paintIntent = (desiredEmoji: ReactionIntent) => {
        applyContentReactions(contentId, projectOwnReaction(event.reactions ?? [], desiredEmoji));
        if (desiredEmoji === null) markSidebarReactionRemoved(communityId, contentId);
        patchSidebarReaction(
          communityId,
          desiredEmoji === null
            ? null
            : {
                messageId: contentId,
                emoji: desiredEmoji,
                createdAt: new Date().toISOString(),
                firstName: "You",
                isOwn: true,
                contentKind: kind,
                messagePreview: contentPreview,
              },
        );
      };

      let coordinator = contentCoordinatorsRef.current.get(contentId);
      if (!coordinator) {
        const initialEmoji =
          event.reactions?.find((r) => r.user_ids.includes(currentUserId))?.emoji ?? null;

        coordinator = new ReactionIntentCoordinator<MessageReaction[]>({
          initialValue: initialEmoji,
          onOptimisticChange: paintIntent,
          onIntentChange: (value, pending) => {
            trackReactionIntent(communityId, contentId, currentUserId, value, pending);
          },
          persist: (desiredEmoji) =>
            persistReaction(
              `/api/communities/${communityId}/content-events/${contentId}/reactions`,
              { kind, desiredEmoji },
            ),
          onConfirmed: ({ value, data }) => {
            applyContentReactions(contentId, data);
            paintIntent(value);
          },
        });
        contentCoordinatorsRef.current.set(contentId, coordinator);
      }

      coordinator.toggle(emoji);
    },
    [applyContentReactions, communityId, currentUserId, projectOwnReaction],
  );

  return { handleReaction, handleContentReaction };
}
