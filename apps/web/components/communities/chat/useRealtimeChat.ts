"use client";

import { useEffect, useRef, useCallback, MutableRefObject } from "react";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import { msgCache, applyReactionInsert, applyReactionDelete } from "@/lib/communities/cache";
import type { CachedContentEvent, CachedMessage, CachedThreadEvent, ContentEventKind, MessageMention, ReplyPreview } from "@/lib/communities/cache";
import type { Member } from "./useChatData";
import { shouldSuppressReactionEcho } from "@/lib/reaction-intent-coordinator";
import { pickOptimisticMatch } from "./chatUtils";

type Message = CachedMessage;

interface UseRealtimeChatOptions {
  communityId: string;
  currentUserId: string;
  fetchMessages: (after?: string, force?: boolean) => Promise<void>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setThreadEvents: React.Dispatch<React.SetStateAction<CachedThreadEvent[]>>;
  /** Permanent "<name> created a …" cards (threads/showcase/resources/events). */
  setContentEvents: React.Dispatch<React.SetStateAction<CachedContentEvent[]>>;
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
  setContentEvents,
  membersRef,
  pendingProfileFetchRef,
  scrollContainerRef,
  initialScrollDoneRef,
  realtimeInsertPendingRef,
  realtimeWasNearBottomRef,
}: UseRealtimeChatOptions) {
  // ── Debounced catch-up fetch ───────────────────────────────────────────────
  // Catch-up fetches bypass the request cache (force) — they exist precisely
  // because the cache/socket may have missed messages, so replaying a cached
  // "no new messages" answer would drop the very messages we're catching up on.
  const catchUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedCatchUp = useCallback(
    (after?: string) => {
      if (catchUpTimerRef.current) clearTimeout(catchUpTimerRef.current);
      catchUpTimerRef.current = setTimeout(() => {
        catchUpTimerRef.current = null;
        fetchMessages(after, true);
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
  const isVisible = useDocumentVisible();
  const chatRoom = realtimeRooms.chat(communityId);

  useEffect(() => {
    if (!isVisible) return;

    realtimeClient.init({ id: currentUserId, name: null, avatar: null });
    const unsubRoom = realtimeClient.subscribe(chatRoom);
    realtimeClient.connect();

    const unsubscribes: Array<() => void> = [];

    // Catch-up on (re)subscription. The sidebar keeps chat sockets for its top
    // communities alive, so switching into an already-connected community fires
    // NO status event — without this, messages sent while the user was in
    // another community would not load until the next focus/visibility change.
    const cachedForCatchUp = msgCache.get(communityId) ?? [];
    const lastRealForCatchUp = cachedForCatchUp
      .filter((m) => !m.id.startsWith("temp-"))
      .at(-1);
    debouncedCatchUp(lastRealForCatchUp?.created_at ?? undefined);

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
          mentions?: MessageMention[];
          /** Sender display info published by the server (see messages POST route). */
          sender_name?: string | null;
          sender_avatar_url?: string | null;
          reply_sender_name?: string | null;
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

          // Match ONE specific optimistic bubble instead of every temp- row by
          // the same user. Removing them all made a second message sent in
          // quick succession blink out of the UI, and its POST merge then
          // became a no-op — the message could stay missing until its own echo
          // arrived. With several sends in flight the echoes can interleave, so
          // the row whose text matches wins (see pickOptimisticMatch).
          const matchedTemp = pickOptimisticMatch(prev, {
            user_id: newRow.user_id,
            content: newRow.content,
          });
          const withoutTemp = matchedTemp
            ? prev.filter((m) => m.id !== matchedTemp.id)
            : prev;
          const senderMember = membersRef.current.find(
            (m) => m.user_id === newRow.user_id
          );
          // Prefer the server-published name/avatar (no round trip); fall back
          // to the local member roster; null only when neither is available —
          // the lazy profile fetch then fills it in.
          const users: CachedMessage["users"] = senderMember?.users ??
            (newRow.sender_name
              ? { name: newRow.sender_name, avatar_url: newRow.sender_avatar_url ?? null }
              : null);

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
                  user_id:   parentInState.user_id,
                };
              } else if (newRow.reply_sender_name) {
                // Server-published parent author name — shows the real
                // "replied to John" immediately instead of a two-step fetch.
                replyTo = {
                  id: newRow.reply_to_id,
                  content: "",
                  user_name: newRow.reply_sender_name,
                  user_id: null,
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
            // When this echo replaces the sender's own optimistic bubble, keep
            // showing the blob URL that is already on screen — swapping straight
            // to the uploaded network URL before it has loaded collapses the
            // bubble into a blank frame for a split second. The POST-response
            // merge (which preloads the uploaded image first) swaps it over
            // seamlessly. Non-blob temps (e.g. GIF URLs) match the DB URL, so
            // they fall through to the real value either way.
            image_url: matchedTemp?.image_url?.startsWith("blob:")
              ? matchedTemp.image_url
              : newRow.image_url ?? null,
            mentions: newRow.mentions ?? [],
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
              .then((preview: { id: string; content: string | null; user_name: string; user_id: string | null } | null) => {
                if (!preview) return;
                setMessages((prev2) => {
                  const msg = prev2.find((m) => m.id === targetMsgId);
                  if (!msg || msg.reply_to) return prev2;
                  const next2 = prev2.map((m) =>
                    m.id === targetMsgId
                      ? { ...m, reply_to: { id: preview.id, content: preview.content ?? "", user_name: preview.user_name, user_id: preview.user_id ?? null } }
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
            !newRow.sender_name &&
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
        // The unified content card for this thread goes too.
        setContentEvents((prev) => prev.filter((e) => e.id !== row.id));
      }),
    );

    // ── Unified content events (threads + showcase + resources + events) ────
    // The server broadcasts one topic per create/delete on the chat room so
    // the timeline's permanent "<name> created a …" card stays current without
    // refetching. (The creator's own optimistic insert dedupes by id.)
    unsubscribes.push(
      realtimeClient.on(chatRoom, "content-insert", (data) => {
        const row = data as {
          id?: string;
          community_id?: string;
          user_id?: string;
          kind?: ContentEventKind;
          title?: string;
          created_at?: string;
          meta?: CachedContentEvent["meta"];
        };
        if (!row.id || !row.user_id || !row.created_at || !row.kind) return;
        const senderMember = membersRef.current.find((m) => m.user_id === row.user_id);
        const event: CachedContentEvent = {
          id: row.id,
          community_id: row.community_id ?? communityId,
          user_id: row.user_id,
          kind: row.kind,
          title: row.title ?? "",
          created_at: row.created_at,
          meta: row.meta ?? null,
          users: senderMember?.users ?? null,
        };
        setContentEvents((prev) => {
          if (prev.some((e) => e.id === event.id)) return prev;
          return [...prev, event].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
          );
        });
      }),
    );

    unsubscribes.push(
      realtimeClient.on(chatRoom, "content-delete", (data) => {
        const row = data as { id?: string };
        if (!row.id) return;
        setContentEvents((prev) => prev.filter((e) => e.id !== row.id));
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
  }, [communityId, fetchMessages, isVisible]);

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
