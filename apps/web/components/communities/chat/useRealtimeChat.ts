"use client";

import { useEffect, MutableRefObject } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { msgCache, applyReactionInsert, applyReactionDelete } from "@/lib/communities/cache";
import type { CachedMessage } from "@/lib/communities/cache";
import type { Member } from "./useChatData";

type Message = CachedMessage;

interface UseRealtimeChatOptions {
  communityId: string;
  fetchMessages: (after?: string) => Promise<void>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  membersRef: MutableRefObject<Member[]>;
  pendingProfileFetchRef: MutableRefObject<Map<string, Promise<void>>>;
  scrollContainerRef: MutableRefObject<HTMLDivElement | null>;
  initialScrollDoneRef: MutableRefObject<boolean>;
  realtimeInsertPendingRef: MutableRefObject<boolean>;
  realtimeWasNearBottomRef: MutableRefObject<boolean>;
}

export function useRealtimeChat({
  communityId,
  fetchMessages,
  setMessages,
  membersRef,
  pendingProfileFetchRef,
  scrollContainerRef,
  initialScrollDoneRef,
  realtimeInsertPendingRef,
  realtimeWasNearBottomRef,
}: UseRealtimeChatOptions) {
  // ── Supabase Realtime ─────────────────────────────────────────────────────
  useEffect(() => {
    let supabase: ReturnType<typeof createBrowserClient>;
    try {
      supabase = createBrowserClient();
    } catch {
      return;
    }

    const hasSubscribedRef = { current: false };

    const channel = supabase
      .channel(`community:${communityId}`)
      // ── New messages ────────────────────────────────────────────────────
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "community_messages",
          filter: `community_id=eq.${communityId}`,
        },
        (payload) => {
          const newRow = payload.new as {
            id: string;
            community_id: string;
            user_id: string;
            content: string;
            created_at: string;
          };

          // Capture scroll position before state update
          if (initialScrollDoneRef.current) {
            const container = scrollContainerRef.current;
            if (container) {
              const dist =
                container.scrollHeight -
                container.scrollTop -
                container.clientHeight;
              realtimeWasNearBottomRef.current = dist < 100;
            } else {
              realtimeWasNearBottomRef.current = false;
            }
            realtimeInsertPendingRef.current = true;
          }

          setMessages((prev) => {
            if (prev.some((m) => m.id === newRow.id)) return prev;
            const withoutTemp = prev.filter(
              (m) =>
                !(m.id.startsWith("temp-") && m.user_id === newRow.user_id)
            );
            const senderMember = membersRef.current.find(
              (m) => m.user_id === newRow.user_id
            );
            const users = senderMember?.users ?? null;
            const incoming: Message = {
              id: newRow.id,
              content: newRow.content,
              created_at: newRow.created_at,
              user_id: newRow.user_id,
              users,
              status: "sent",
              reactions: [],
            };
            const next = [...withoutTemp, incoming].sort(
              (a, b) =>
                new Date(a.created_at).getTime() -
                new Date(b.created_at).getTime()
            );
            msgCache.set(communityId, next);

            // Lazy-load profile for unknown senders
            if (
              !senderMember &&
              !pendingProfileFetchRef.current.has(newRow.user_id)
            ) {
              const targetCommunityId = communityId;
              const targetUserId      = newRow.user_id;
              const targetMsgId       = newRow.id;
              const p: Promise<void> = fetch(
                `/api/communities/${targetCommunityId}/members/${targetUserId}`
              )
                .then((r) => (r.ok ? r.json() : null))
                .then(
                  (profile: {
                    name: string;
                    avatar_url: string | null;
                  } | null) => {
                    if (!profile) return;
                    const resolvedUsers = {
                      name: profile.name,
                      avatar_url: profile.avatar_url,
                    };
                    membersRef.current = [
                      ...membersRef.current,
                      { user_id: targetUserId, users: resolvedUsers },
                    ];
                    setMessages((prev) => {
                      const next = prev.map((m) =>
                        m.id === targetMsgId && m.users === null
                          ? { ...m, users: resolvedUsers }
                          : m
                      );
                      msgCache.set(targetCommunityId, next);
                      return next;
                    });
                  }
                )
                .catch(() => {})
                .finally(() => {
                  pendingProfileFetchRef.current.delete(targetUserId);
                });
              pendingProfileFetchRef.current.set(targetUserId, p);
            }

            return next;
          });
        }
      )
      // ── Reaction INSERT ─────────────────────────────────────────────────
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reactions",
          filter: `community_id=eq.${communityId}`,
        },
        (payload) => {
          const r = payload.new as {
            message_id: string;
            user_id: string;
            emoji: string;
          };
          setMessages((prev) => {
            const next = prev.map((m) =>
              m.id === r.message_id
                ? {
                    ...m,
                    reactions: applyReactionInsert(
                      m.reactions ?? [],
                      r.emoji,
                      r.user_id
                    ),
                  }
                : m
            );
            msgCache.set(communityId, next);
            return next;
          });
        }
      )
      // ── Reaction UPDATE (emoji change) ──────────────────────────────────
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "message_reactions",
          filter: `community_id=eq.${communityId}`,
        },
        (payload) => {
          const oldR = payload.old as { message_id: string; user_id: string; emoji: string };
          const newR = payload.new as { message_id: string; user_id: string; emoji: string };
          setMessages((prev) => {
            const next = prev.map((m) => {
              if (m.id !== newR.message_id) return m;
              const afterDelete = applyReactionDelete(m.reactions ?? [], oldR.emoji, oldR.user_id);
              const afterInsert = applyReactionInsert(afterDelete, newR.emoji, newR.user_id);
              return { ...m, reactions: afterInsert };
            });
            msgCache.set(communityId, next);
            return next;
          });
        }
      )
      // ── Reaction DELETE ─────────────────────────────────────────────────
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "message_reactions",
          filter: `community_id=eq.${communityId}`,
        },
        (payload) => {
          const r = payload.old as {
            message_id?: string;
            user_id?: string;
            emoji?: string;
          };
          // Guard: message_id / user_id / emoji are only present when the table
          // has REPLICA IDENTITY FULL. Without the migration applied they will
          // be undefined, so skip the update to avoid corrupting local state.
          if (!r.message_id || !r.user_id || !r.emoji) return;
          setMessages((prev) => {
            const next = prev.map((m) =>
              m.id === r.message_id
                ? {
                    ...m,
                    reactions: applyReactionDelete(
                      m.reactions ?? [],
                      r.emoji!,
                      r.user_id!
                    ),
                  }
                : m
            );
            msgCache.set(communityId, next);
            return next;
          });
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (!hasSubscribedRef.current) {
            hasSubscribedRef.current = true;
          } else {
            // Reconnected — catch up on missed messages
            const cached   = msgCache.get(communityId) ?? [];
            const lastReal = cached
              .filter((m) => !m.id.startsWith("temp-"))
              .at(-1);
            fetchMessages(lastReal?.created_at ?? undefined);
          }
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, fetchMessages]);

  // ── Tab visibility / window focus catch-up ────────────────────────────────
  useEffect(() => {
    const handleCatchUp = () => {
      if (document.visibilityState !== "visible") return;
      const cached   = msgCache.get(communityId) ?? [];
      const lastReal = cached
        .filter((m) => !m.id.startsWith("temp-"))
        .at(-1);
      fetchMessages(lastReal?.created_at ?? undefined);
    };
    document.addEventListener("visibilitychange", handleCatchUp);
    window.addEventListener("focus", handleCatchUp);
    return () => {
      document.removeEventListener("visibilitychange", handleCatchUp);
      window.removeEventListener("focus", handleCatchUp);
    };
  }, [communityId, fetchMessages]);
}
