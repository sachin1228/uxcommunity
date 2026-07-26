"use client";

import { useEffect, MutableRefObject } from "react";
import { createBrowserClient } from "@/lib/supabase/browser";
import { msgCache, applyReactionInsert, applyReactionDelete } from "@/lib/communities/cache";
import type { CachedMessage, CachedThreadEvent, ReplyPreview } from "@/lib/communities/cache";
import type { Member } from "./useChatData";

type Message = CachedMessage;

interface UseRealtimeChatOptions {
  communityId: string;
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
            reply_to_id: string | null;
            image_url: string | null;
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

            // Capture the temp message being replaced so we can inherit its
            // reply_to — this avoids a second setMessages call (and render).
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
            const users = senderMember?.users ?? null;

            // Resolve reply_to in this same state update to avoid a flicker:
            //   1. Inherit from the replaced temp message (sender's own send).
            //   2. Build from parent already in local state (other user's msg).
            //   3. null for now — async fallback fetch below fills it in later.
            let replyTo: ReplyPreview | null = null;
            if (newRow.reply_to_id) {
              if (matchedTemp?.reply_to) {
                // Sender path: temp message already had the full preview.
                replyTo = matchedTemp.reply_to;
              } else {
                // Receiver path: look for the parent in the already-loaded list.
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

            // Async fallback: only needed when reply_to_id is set but the
            // parent message is not in local state (e.g. very old message).
            // This fires after the state update so it never causes a flicker
            // on the common path — it only runs in the rare edge case.
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
      // ── Message soft-delete (UPDATE with deleted_at set) ─────────────────
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "community_messages",
          filter: `community_id=eq.${communityId}`,
        },
        (payload) => {
          const updated = payload.new as {
            id: string;
            deleted_at: string | null;
          };
          // Only care about soft-deletes; ignore other updates.
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
      // ── New thread created ──────────────────────────────────────────────
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "community_threads",
          filter: `community_id=eq.${communityId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            community_id: string;
            user_id: string;
            title: string;
            description: string;
            category: string;
            attachments: Array<{ name: string; url: string; type: string; size: number }>;
            created_at: string;
          };

          // Resolve author from local member list; lazy-fetch if unknown.
          const senderMember = membersRef.current.find((m) => m.user_id === row.user_id);
          const users = senderMember?.users ?? null;

          const event: CachedThreadEvent = {
            id:           row.id,
            community_id: row.community_id,
            user_id:      row.user_id,
            title:        row.title,
            description:  row.description,
            category:     row.category,
            attachments:  row.attachments ?? [],
            created_at:   row.created_at,
            users,
          };

          setThreadEvents((prev) => {
            if (prev.some((e) => e.id === event.id)) return prev;
            return [...prev, event].sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
            );
          });

          // Lazy-fetch profile if the author isn't in our member list yet.
          if (!senderMember && !pendingProfileFetchRef.current.has(row.user_id)) {
            const targetUserId  = row.user_id;
            const targetEventId = row.id;
            const p: Promise<void> = fetch(
              `/api/communities/${communityId}/members/${targetUserId}`
            )
              .then((r) => (r.ok ? r.json() : null))
              .then((profile: { name: string; avatar_url: string | null } | null) => {
                if (!profile) return;
                const resolvedUsers = { name: profile.name, avatar_url: profile.avatar_url };
                membersRef.current = [
                  ...membersRef.current,
                  { user_id: targetUserId, users: resolvedUsers },
                ];
                setThreadEvents((prev) =>
                  prev.map((e) =>
                    e.id === targetEventId && e.users === null
                      ? { ...e, users: resolvedUsers }
                      : e
                  )
                );
              })
              .catch(() => {})
              .finally(() => { pendingProfileFetchRef.current.delete(targetUserId); });
            pendingProfileFetchRef.current.set(targetUserId, p);
          }
        }
      )
      // ── Thread updated (title / description / category / attachments) ───
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "community_threads",
          filter: `community_id=eq.${communityId}`,
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            title: string;
            description: string;
            category: string;
            attachments: Array<{ name: string; url: string; type: string; size: number }>;
          };
          setThreadEvents((prev) =>
            prev.map((e) =>
              e.id === row.id
                ? {
                    ...e,
                    title:       row.title,
                    description: row.description,
                    category:    row.category,
                    attachments: row.attachments ?? [],
                  }
                : e
            )
          );
        }
      )
      // ── Thread deleted ───────────────────────────────────────────────────
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "community_threads",
          filter: `community_id=eq.${communityId}`,
        },
        (payload) => {
          const row = payload.old as { id?: string };
          if (!row.id) return;
          setThreadEvents((prev) => prev.filter((e) => e.id !== row.id));
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
