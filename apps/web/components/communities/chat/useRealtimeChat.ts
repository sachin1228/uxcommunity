"use client";

import { useEffect, useRef, useCallback, MutableRefObject } from "react";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { msgCache, applyReactionInsert, applyReactionDelete } from "@/lib/communities/cache";
import type { CachedMessage, CachedThreadEvent, ReplyPreview } from "@/lib/communities/cache";
import type { Member } from "./useChatData";
import { shouldSuppressReactionEcho } from "@/lib/reaction-intent-coordinator";

type Message = CachedMessage;

interface UseRealtimeChatOptions {
  communityId: string;
  currentUserId: string;
  fetchMessages: (after?: string) => Promise<void>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setThreadEvents: React.Dispatch<React.SetStateAction<CachedThreadEvent[]>>;
  membersRef: MutableRefObject<Member[]>;
  pendingProfileFetchRef: MutableRefObject<Map<string, Promise<void>>>;
  scrollContainerRef: MutableRefObject<HTMLDivElement | null>;
  initialScrollDoneRef: MutableRefObject<boolean>;
  realtimeInsertPendingRef: MutableRefObject<boolean>;
  realtimeWasNearBottomRef: MutableRefObject<boolean>;
}

export function useRealtimeChat({
  communityId,
  currentUserId,
  fetchMessages,
  setMessages,
  setThreadEvents,
  membersRef,
  pendingProfileFetchRef,
  scrollContainerRef,
  initialScrollDoneRef,
  realtimeInsertPendingRef,
  realtimeWasNearBottomRef,
}: UseRealtimeChatOptions) {
  // ── Debounced catch-up fetch ───────────────────────────────────────────────
  const catchUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedCatchUp = useCallback(
    (after?: string) => {
      if (catchUpTimerRef.current) clearTimeout(catchUpTimerRef.current);
      catchUpTimerRef.current = setTimeout(() => {
        catchUpTimerRef.current = null;
        fetchMessages(after);
      }, 300);
    },
    [fetchMessages],
  );

  useEffect(() => () => {
    if (catchUpTimerRef.current) {
      clearTimeout(catchUpTimerRef.current);
      catchUpTimerRef.current = null;
    }
  }, [communityId, debouncedCatchUp]);

  // ── Realtime (Cloudflare multiplexed) ──────────────────────────────────────
  // Visibility does NOT tear down the chat subscription. Catch-up on return
  // from hidden is handled by the separate visibilitychange/focus listener
  // below and the onStatus reconnect handler. Tearing down on hide caused
  // race conditions with sibling hooks (typing, presence) that share the
  // same room/connection.
  const chatRoom = realtimeRooms.chat(communityId);

  useEffect(() => {
    realtimeClient.init({ id: currentUserId, name: null, avatar: null });
    const unsubRoom = realtimeClient.subscribe(chatRoom);
    realtimeClient.connect();

    const unsubscribes: Array<() => void> = [];

    // ── New messages ───────────────────────────────────────────────────────
    unsubscribes.push(
      realtimeClient.on(chatRoom, "message", (data) => {
        const newRow = data as {
          id: string;
          community_id: string;
          user_id: string;
          content: string;
          created_at: string;
          reply_to_id: string | null;
          image_url: string | null;
        };

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

          const matchedTemp = prev.find(
            (m) => m.id.startsWith("temp-") && m.user_id === newRow.user_id
          );
          const withoutTemp = prev.filter(
            (m) =>
              !(m.id.startsWith("temp-") && m.user_id === newRow.user_id)
          );
          const senderMember = membersRef.current.find(
            (m) => m.user_id === newRow.user_id
          );
          const users: CachedMessage["users"] = senderMember?.users ?? null;

          let replyTo: ReplyPreview | null = null;
          if (newRow.reply_to_id) {
            if (matchedTemp?.reply_to) {
              replyTo = matchedTemp.reply_to;
            } else {
              const parentInState = prev.find((m) => m.id === newRow.reply_to_id);
              if (parentInState) {
                replyTo = {
                  id:        parentInState.id,
                  content:   parentInState.content ?? "",
                  user_name: parentInState.users?.name ?? "Unknown",
                };
              }
            }
          }

          const incoming: Message = {
            id: newRow.id,
            content: newRow.content,
            created_at: newRow.created_at,
            user_id: newRow.user_id,
            users,
            status: "sent",
            reactions: [],
            reply_to: replyTo,
            image_url: newRow.image_url ?? null,
          };
          const next = [...withoutTemp, incoming].sort(
            (a, b) =>
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime()
          );
          msgCache.set(communityId, next);

          if (newRow.reply_to_id && !replyTo) {
            const targetCommunityId = communityId;
            const targetMsgId       = newRow.id;
            const targetReplyToId   = newRow.reply_to_id;

            fetch(`/api/communities/${targetCommunityId}/messages/${targetReplyToId}`)
              .then((r) => (r.ok ? r.json() : null))
              .then((preview: { id: string; content: string | null; user_name: string } | null) => {
                if (!preview) return;
                setMessages((prev2) => {
                  const msg = prev2.find((m) => m.id === targetMsgId);
                  if (!msg || msg.reply_to) return prev2;
                  const next2 = prev2.map((m) =>
                    m.id === targetMsgId
                      ? { ...m, reply_to: { id: preview.id, content: preview.content ?? "", user_name: preview.user_name } }
                      : m
                  );
                  msgCache.set(targetCommunityId, next2);
                  return next2;
                });
              })
              .catch(() => {});
          }

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
                  designation?: string | null;
                } | null) => {
                  if (!profile) return;
                  const resolvedUsers = {
                    name:        profile.name,
                    avatar_url:  profile.avatar_url,
                    designation: profile.designation ?? null,
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
      }),
    );

    // ── Message edit ────────────────────────────────────────────────────────
    unsubscribes.push(
      realtimeClient.on(chatRoom, "message-edit", (data) => {
        const updated = data as {
          id: string;
          content: string;
          edited_at: string | null;
        };
        setMessages((prev) => {
          if (!prev.some((m) => m.id === updated.id)) return prev;
          const next = prev.map((m) =>
            m.id === updated.id
              ? { ...m, content: updated.content, edited_at: updated.edited_at }
              : m,
          );
          msgCache.set(communityId, next);
          return next;
        });
      }),
    );

    // ── Message soft-delete ──────────────────────────────────────────────────
    unsubscribes.push(
      realtimeClient.on(chatRoom, "message-delete", (data) => {
        const updated = data as {
          id: string;
          deleted_at: string | null;
        };
        if (!updated.deleted_at) return;
        setMessages((prev) => {
          if (!prev.some((m) => m.id === updated.id)) return prev;
          const next = prev.map((m) =>
            m.id === updated.id
              ? { ...m, deleted_at: updated.deleted_at, content: "", image_url: null, reply_to: null, reactions: [] }
              : m
          );
          msgCache.set(communityId, next);
          return next;
        });
      }),
    );

    // ── Reactions ────────────────────────────────────────────────────────────
    unsubscribes.push(
      realtimeClient.on(chatRoom, "reaction-insert", (data) => {
        const r = data as { message_id: string; user_id: string; emoji: string };
        if (r.user_id === currentUserId && shouldSuppressReactionEcho(communityId, r.message_id, r.user_id)) return;
        setMessages((prev) => {
          const next = prev.map((m) =>
            m.id === r.message_id
              ? { ...m, reactions: applyReactionInsert(m.reactions ?? [], r.emoji, r.user_id) }
              : m
          );
          msgCache.set(communityId, next);
          return next;
        });
      }),
    );

    unsubscribes.push(
      realtimeClient.on(chatRoom, "reaction-update", (data) => {
        const { old: oldR, new: newR } = data as {
          old: { message_id: string; user_id: string; emoji: string };
          new: { message_id: string; user_id: string; emoji: string };
        };
        if (newR.user_id === currentUserId && shouldSuppressReactionEcho(communityId, newR.message_id, newR.user_id)) return;
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
      }),
    );

    unsubscribes.push(
      realtimeClient.on(chatRoom, "reaction-delete", (data) => {
        const r = data as { message_id: string; user_id: string; emoji: string };
        if (!r.message_id || !r.user_id || !r.emoji) return;
        if (r.user_id === currentUserId && shouldSuppressReactionEcho(communityId, r.message_id, r.user_id)) return;
        setMessages((prev) => {
          const next = prev.map((m) =>
            m.id === r.message_id
              ? { ...m, reactions: applyReactionDelete(m.reactions ?? [], r.emoji, r.user_id) }
              : m
          );
          msgCache.set(communityId, next);
          return next;
        });
      }),
    );

    // ── Thread events from chat room ─────────────────────────────────────────
    unsubscribes.push(
      realtimeClient.on(chatRoom, "thread-insert", (data) => {
        const row = data as {
          id: string; community_id: string; user_id: string;
          title: string; category: string;
          attachments: Array<{ name: string; url: string; type: string; size: number }>;
          created_at: string;
        };
        const senderMember = membersRef.current.find((m) => m.user_id === row.user_id);
        const users = senderMember?.users ?? null;
        const event: CachedThreadEvent = {
          id: row.id, community_id: row.community_id, user_id: row.user_id,
          title: row.title, category: row.category, attachments: row.attachments ?? [],
          created_at: row.created_at, users,
        };
        setThreadEvents((prev) => {
          if (prev.some((e) => e.id === event.id)) return prev;
          return [...prev, event].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        });
      }),
    );

    unsubscribes.push(
      realtimeClient.on(chatRoom, "thread-update", (data) => {
        const row = data as { id: string; title: string; category: string; attachments: Array<{ name: string; url: string; type: string; size: number }> };
        setThreadEvents((prev) =>
          prev.map((e) => e.id === row.id ? { ...e, title: row.title, category: row.category, attachments: row.attachments ?? [] } : e)
        );
      }),
    );

    unsubscribes.push(
      realtimeClient.on(chatRoom, "thread-delete", (data) => {
        const row = data as { id?: string };
        if (!row.id) return;
        setThreadEvents((prev) => prev.filter((e) => e.id !== row.id));
      }),
    );

    // On reconnect, run catch-up
    const unsubStatus = realtimeClient.onStatus((connected) => {
      if (!connected) return;
      const cached   = msgCache.get(communityId) ?? [];
      const lastReal = cached.filter((m) => !m.id.startsWith("temp-")).at(-1);
      debouncedCatchUp(lastReal?.created_at ?? undefined);
    });

    return () => {
      unsubStatus();
      unsubscribes.forEach((unsub) => unsub());
      unsubRoom();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, fetchMessages]);

  // ── Tab visibility / window focus catch-up ────────────────────────────────
  useEffect(() => {
    const handleCatchUp = () => {
      if (document.visibilityState !== "visible") return;
      const cached   = msgCache.get(communityId) ?? [];
      const lastReal = cached.filter((m) => !m.id.startsWith("temp-")).at(-1);
      debouncedCatchUp(lastReal?.created_at ?? undefined);
    };
    document.addEventListener("visibilitychange", handleCatchUp);
    window.addEventListener("focus", handleCatchUp);
    return () => {
      document.removeEventListener("visibilitychange", handleCatchUp);
      window.removeEventListener("focus", handleCatchUp);
    };
  }, [communityId, debouncedCatchUp]);
}
