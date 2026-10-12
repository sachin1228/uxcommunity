"use client";

import { useEffect, useRef, useCallback, MutableRefObject } from "react";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { pickOptimisticMatch } from "@/components/communities/chat/chatUtils";
import { dmCache, bumpConversationWithMessage, patchConversationPreview } from "@/lib/direct-messages/client-cache";
import { markConversationRead, isActivelyReading } from "@/lib/direct-messages/read-manager";
import { shouldSuppressReactionEcho } from "@/lib/reaction-intent-coordinator";
import { applyReactionDelete, applyReactionInsert } from "@/lib/communities/cache";
import type { DmConversationSummary, DmMessage, DmPreviewMessage } from "@/lib/direct-messages/types";
import type { MessageDeletedByRole, ReplyPreview } from "@/lib/communities/cache";

interface DmMessageEvent {
  id: string;
  conversation_id: string;
  participants?: string[];
  user_id: string;
  sender_name?: string | null;
  sender_avatar_url?: string | null;
  content: string;
  created_at: string;
  reply_to_id: string | null;
  reply_sender_name?: string | null;
  image_url: string | null;
}

/**
 * The single DM realtime subscription.
 *
 * ONE socket subscription (`dm:${userId}` multiplexed over the user socket)
 * carries every conversation's events for the whole session — switching
 * conversations never re-subscribes. Events for the open conversation merge
 * into the thread; every event patches the conversation list; live messages
 * on the open+visible conversation are marked read immediately.
 *
 * Catch-up policy mirrors the community chat: debounced incremental `?after=`
 * refetch on (re)subscribe, reconnect and tab return — a missed event is
 * always corrected from the database.
 */
export function useDmRealtime({
  userId,
  activeConversationIdRef,
  conversationsRef,
  setConversations,
  refreshConversations,
  setMessages,
  scrollContainerRef,
  initialScrollDoneRef,
  realtimeInsertPendingRef,
  realtimeWasNearBottomRef,
  fetchActiveCatchUp,
  onTypingEvent,
  onTypingCleared,
}: {
  userId: string;
  activeConversationIdRef: MutableRefObject<string | null>;
  conversationsRef: MutableRefObject<DmConversationSummary[] | null>;
  setConversations: (
    next:
      | DmConversationSummary[]
      | ((current: DmConversationSummary[]) => DmConversationSummary[]),
  ) => void;
  refreshConversations: (force?: boolean) => Promise<void>;
  setMessages: (next: DmMessage[] | ((current: DmMessage[]) => DmMessage[])) => void;
  scrollContainerRef: MutableRefObject<HTMLDivElement | null>;
  initialScrollDoneRef: MutableRefObject<boolean>;
  realtimeInsertPendingRef: MutableRefObject<boolean>;
  realtimeWasNearBottomRef: MutableRefObject<boolean>;
  /** Incremental catch-up for the OPEN conversation (`after` = last known). */
  fetchActiveCatchUp: (after?: string) => void;
  onTypingEvent: (event: {
    conversation_id: string;
    user_id: string;
    name?: string;
    typing: boolean;
  }) => void;
  onTypingCleared: (conversationId: string, userId: string) => void;
}) {
  const isVisible = useDocumentVisible();
  const dmRoom = realtimeRooms.dm(userId);

  // ── Debounced catch-up ───────────────────────────────────────────────────
  const catchUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedCatchUp = useCallback(() => {
    if (catchUpTimerRef.current) clearTimeout(catchUpTimerRef.current);
    catchUpTimerRef.current = setTimeout(() => {
      catchUpTimerRef.current = null;
      void refreshConversations(true);
      const activeId = activeConversationIdRef.current;
      if (activeId) {
        const cached = dmCache.getMessages(activeId) ?? [];
        const lastReal = cached.filter((m) => !m.id.startsWith("temp-")).at(-1);
        fetchActiveCatchUp(lastReal?.created_at);
      }
    }, 300);
  }, [refreshConversations, fetchActiveCatchUp, activeConversationIdRef]);

  useEffect(() => () => {
    if (catchUpTimerRef.current) clearTimeout(catchUpTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isVisible) return;

    realtimeClient.init({ id: userId, name: null, avatar: null });
    const unsubRoom = realtimeClient.subscribe(dmRoom);
    realtimeClient.connect();

    const unsubscribes: Array<() => void> = [];

    // Catch-up on (re)subscription: the socket may already be up (the topbar
    // badge hook keeps it alive) so no status event fires for this mount.
    debouncedCatchUp();

    // ── New message ─────────────────────────────────────────────────────────
    unsubscribes.push(
      realtimeClient.on(dmRoom, "dm-message", (data) => {
        const row = data as DmMessageEvent;
        if (!row?.id || !row.conversation_id) return;

        const isOwnMessage = row.user_id === userId;
        const isOpenConversation = activeConversationIdRef.current === row.conversation_id;

        if (isOpenConversation) {
          if (initialScrollDoneRef.current) {
            const container = scrollContainerRef.current;
            realtimeWasNearBottomRef.current = container
              ? container.scrollHeight - container.scrollTop - container.clientHeight < 100
              : false;
            realtimeInsertPendingRef.current = true;
          }

          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;

            // One specific optimistic bubble is replaced (never every temp
            // row): concurrent sends' echoes interleave, so text match wins.
            const matchedTemp = pickOptimisticMatch(prev, {
              user_id: row.user_id,
              content: row.content,
            });
            const withoutTemp = matchedTemp ? prev.filter((m) => m.id !== matchedTemp.id) : prev;

            let replyTo: ReplyPreview | null = null;
            if (row.reply_to_id) {
              if (matchedTemp?.reply_to) {
                replyTo = matchedTemp.reply_to;
              } else {
                const parentInState = prev.find((m) => m.id === row.reply_to_id);
                if (parentInState) {
                  replyTo = {
                    id: parentInState.id,
                    content: parentInState.content ?? "",
                    user_name: parentInState.users?.name ?? "Unknown",
                    user_id: parentInState.user_id,
                  };
                } else if (row.reply_sender_name) {
                  replyTo = {
                    id: row.reply_to_id,
                    content: "",
                    user_name: row.reply_sender_name,
                    user_id: null,
                  };
                }
              }
            }

            const incoming: DmMessage = {
              id: row.id,
              content: row.content,
              created_at: row.created_at,
              user_id: row.user_id,
              users: {
                name: row.sender_name ?? "Someone",
                avatar_url: row.sender_avatar_url ?? null,
              },
              status: "sent",
              reactions: [],
              reply_to: replyTo,
              image_url: matchedTemp?.image_url?.startsWith("blob:")
                ? matchedTemp.image_url
                : row.image_url ?? null,
            };
            const next = [...withoutTemp, incoming].sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
            );

            // Parent preview not resolvable from state — fetch it lazily.
            if (row.reply_to_id && !replyTo) {
              const targetConversationId = row.conversation_id;
              const targetMsgId = row.id;
              const targetReplyToId = row.reply_to_id;
              fetch(`/api/dm/messages/${targetReplyToId}`)
                .then((r) => (r.ok ? r.json() : null))
                .then((preview: { id: string; content: string | null; user_name: string; user_id: string | null } | null) => {
                  if (!preview) return;
                  setMessages((prev2) => {
                    const msg = prev2.find((m) => m.id === targetMsgId);
                    if (!msg || msg.reply_to) return prev2;
                    const next2 = prev2.map((m) =>
                      m.id === targetMsgId
                        ? { ...m, reply_to: { id: preview.id, content: preview.content ?? "", user_name: preview.user_name, user_id: preview.user_id ?? null } }
                        : m,
                    );
                    dmCache.setMessages(targetConversationId, next2.filter((m) => !m.id.startsWith("temp-")));
                    return next2;
                  });
                })
                .catch(() => {});
            }

            return next;
          });

          // The peer's typing indicator clears the moment their message lands.
          if (!isOwnMessage) onTypingCleared(row.conversation_id, row.user_id);
        }

        // ── Conversation list + read marker ─────────────────────────────────
        const preview: DmPreviewMessage = {
          id: row.id,
          content: row.content || null,
          image_url: row.image_url ?? null,
          created_at: row.created_at,
          user_id: row.user_id,
          deleted_at: null,
          edited_at: null,
        };
        const current = conversationsRef.current;
        if (current) {
          const next = bumpConversationWithMessage(current, {
            conversationId: row.conversation_id,
            viewerId: userId,
            message: preview,
            activelyReading: isActivelyReading(row.conversation_id),
          });
          if (next === current) {
            // First message of a conversation this client has never seen —
            // the list must learn the peer's identity.
            void refreshConversations(true);
          } else {
            setConversations(next);
          }
        }

        if (!isOwnMessage && isActivelyReading(row.conversation_id)) {
          markConversationRead(row.conversation_id);
        }
      }),
    );

    // ── Edit ────────────────────────────────────────────────────────────────
    unsubscribes.push(
      realtimeClient.on(dmRoom, "dm-message-edit", (data) => {
        const updated = data as { conversation_id: string; id: string; content: string; edited_at: string | null };
        if (!updated?.id) return;
        if (activeConversationIdRef.current === updated.conversation_id) {
          setMessages((prev) => {
            if (!prev.some((m) => m.id === updated.id)) return prev;
            const next = prev.map((m) =>
              m.id === updated.id ? { ...m, content: updated.content, edited_at: updated.edited_at } : m,
            );
            dmCache.setMessages(updated.conversation_id, next.filter((m) => !m.id.startsWith("temp-")));
            return next;
          });
        }
        setConversations((prev) =>
          patchConversationPreview(prev, {
            conversationId: updated.conversation_id,
            messageId: updated.id,
            patch: { content: updated.content, edited_at: updated.edited_at },
          }),
        );
      }),
    );

    // ── Soft delete ─────────────────────────────────────────────────────────
    unsubscribes.push(
      realtimeClient.on(dmRoom, "dm-message-delete", (data) => {
        const updated = data as { conversation_id: string; id: string; deleted_at: string | null };
        if (!updated?.id || !updated.deleted_at) return;
        if (activeConversationIdRef.current === updated.conversation_id) {
          setMessages((prev) => {
            if (!prev.some((m) => m.id === updated.id)) return prev;
            const next = prev.map((m) =>
              m.id === updated.id
                ? {
                    ...m,
                    deleted_at: updated.deleted_at,
                    deleted_by: null as string | null,
                    deleted_by_role: null as MessageDeletedByRole | null,
                    content: "",
                    image_url: null,
                    reply_to: null,
                    reactions: [],
                  }
                : m,
            );
            dmCache.setMessages(updated.conversation_id, next.filter((m) => !m.id.startsWith("temp-")));
            return next;
          });
        }
        setConversations((prev) =>
          patchConversationPreview(prev, {
            conversationId: updated.conversation_id,
            messageId: updated.id,
            patch: { content: null, image_url: null, deleted_at: updated.deleted_at },
          }),
        );
      }),
    );

    // ── Reactions ───────────────────────────────────────────────────────────
    unsubscribes.push(
      realtimeClient.on(dmRoom, "dm-reaction-insert", (data) => {
        const r = data as { conversation_id: string; message_id: string; user_id: string; emoji: string };
        if (!r?.message_id) return;
        if (r.user_id === userId && shouldSuppressReactionEcho(r.conversation_id, r.message_id, r.user_id)) return;
        if (activeConversationIdRef.current !== r.conversation_id) return;
        setMessages((prev) => {
          const next = prev.map((m) =>
            m.id === r.message_id
              ? { ...m, reactions: applyReactionInsert(m.reactions ?? [], r.emoji, r.user_id) }
              : m,
          );
          dmCache.setMessages(r.conversation_id, next.filter((m) => !m.id.startsWith("temp-")));
          return next;
        });
      }),
    );

    unsubscribes.push(
      realtimeClient.on(dmRoom, "dm-reaction-update", (data) => {
        const { old: oldR, new: newR } = data as {
          old: { conversation_id: string; message_id: string; user_id: string; emoji: string };
          new: { conversation_id: string; message_id: string; user_id: string; emoji: string };
        };
        if (!newR?.message_id) return;
        if (newR.user_id === userId && shouldSuppressReactionEcho(newR.conversation_id, newR.message_id, newR.user_id)) return;
        if (activeConversationIdRef.current !== newR.conversation_id) return;
        setMessages((prev) => {
          const next = prev.map((m) => {
            if (m.id !== newR.message_id) return m;
            const afterDelete = applyReactionDelete(m.reactions ?? [], oldR.emoji, oldR.user_id);
            return { ...m, reactions: applyReactionInsert(afterDelete, newR.emoji, newR.user_id) };
          });
          dmCache.setMessages(newR.conversation_id, next.filter((m) => !m.id.startsWith("temp-")));
          return next;
        });
      }),
    );

    unsubscribes.push(
      realtimeClient.on(dmRoom, "dm-reaction-delete", (data) => {
        const r = data as { conversation_id: string; message_id: string; user_id: string; emoji: string };
        if (!r?.message_id || !r.user_id || !r.emoji) return;
        if (r.user_id === userId && shouldSuppressReactionEcho(r.conversation_id, r.message_id, r.user_id)) return;
        if (activeConversationIdRef.current !== r.conversation_id) return;
        setMessages((prev) => {
          const next = prev.map((m) =>
            m.id === r.message_id
              ? { ...m, reactions: applyReactionDelete(m.reactions ?? [], r.emoji, r.user_id) }
              : m,
          );
          dmCache.setMessages(r.conversation_id, next.filter((m) => !m.id.startsWith("temp-")));
          return next;
        });
      }),
    );

    // ── Typing ──────────────────────────────────────────────────────────────
    unsubscribes.push(
      realtimeClient.on(dmRoom, "dm-typing", (data) => {
        const payload = data as {
          conversation_id?: string;
          user_id?: string;
          name?: string;
          typing?: boolean;
        };
        if (!payload?.conversation_id || !payload.user_id) return;
        if (payload.user_id === userId) return;
        onTypingEvent({
          conversation_id: payload.conversation_id,
          user_id: payload.user_id,
          name: payload.name,
          typing: payload.typing === true,
        });
      }),
    );

    // Reconnect → catch up.
    const unsubStatus = realtimeClient.onStatus((connected) => {
      if (!connected) return;
      debouncedCatchUp();
    });

    return () => {
      unsubStatus();
      unsubscribes.forEach((unsub) => unsub());
      unsubRoom();
    };
    // Handlers read live values through refs and stable setters; the
    // subscription itself only depends on identity + visibility.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, isVisible]);

  // ── Tab back → catch up ───────────────────────────────────────────────────
  useEffect(() => {
    const handleCatchUp = () => {
      if (document.visibilityState !== "visible") return;
      debouncedCatchUp();
    };
    document.addEventListener("visibilitychange", handleCatchUp);
    window.addEventListener("focus", handleCatchUp);
    return () => {
      document.removeEventListener("visibilitychange", handleCatchUp);
      window.removeEventListener("focus", handleCatchUp);
    };
  }, [debouncedCatchUp]);
}
