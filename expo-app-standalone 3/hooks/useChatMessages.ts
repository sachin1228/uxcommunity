/**
 * Loads and keeps messages live for a single community chat.
 * - Initial load: last 50 messages via GET /api/communities/:id/messages
 * - Pagination: older messages via ?before=<ISO>
 * - Realtime: Cloudflare Durable Object WebSocket (message, message-edit,
 *   message-delete, reaction-insert/update/delete)
 */

import { useCallback, useEffect, useState } from 'react';
import { realtimeClient, realtimeRooms } from '@/lib/realtime';
import {
  getMessages,
  markRead,
  Message,
  Reaction,
} from '@/lib/communities';
import { pickOptimisticMatch } from '@/lib/chat';
import { useAuth } from '@/context/AuthContext';

/**
 * True for an optimistic upload preview (a device-local URI rather than the
 * uploaded CDN URL). Keeping it on screen while the echo lands avoids the
 * split-second blank frame an un-loaded network URL would show.
 */
function isLocalUri(uri: string | null | undefined): boolean {
  if (!uri) return false;
  return !/^https?:\/\//i.test(uri);
}

export function useChatMessages(communityId: string) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const msgs = await getMessages(communityId);
      setMessages(msgs);
      setHasMore(msgs.length === 50);
      await markRead(communityId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load messages');
    } finally {
      setIsLoading(false);
    }
  }, [communityId]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || messages.length === 0) return;
    const oldest = messages[0]?.created_at;
    if (!oldest) return;
    setIsLoadingMore(true);
    try {
      const older = await getMessages(communityId, oldest);
      setMessages((prev) => [...older, ...prev]);
      setHasMore(older.length === 50);
    } catch {
      // silent — user can scroll again
    } finally {
      setIsLoadingMore(false);
    }
  }, [communityId, messages, isLoadingMore, hasMore]);

  /** Optimistically append a sent message. */
  const appendMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  /** Update reactions on a specific message. */
  const updateReactions = useCallback((messageId: string, reactions: Reaction[]) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, reactions } : m))
    );
  }, []);

  /** Soft-delete a message locally (mirrors the server setting deleted_at). */
  const softDeleteMessage = useCallback((messageId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId
          ? {
              ...m,
              deleted_at: new Date().toISOString(),
              content: null,
              image_url: null,
              reply_to: null,
              reactions: [],
            }
          : m,
      )
    );
  }, []);

  /** Patch one message in place (used by the edit flow). */
  const patchMessage = useCallback((messageId: string, patch: Partial<Message>) => {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, ...patch } : m)));
  }, []);

  // Realtime subscription via Cloudflare singleton
  useEffect(() => {
    if (!user?.id) return;

    const room = realtimeRooms.chat(communityId);

    realtimeClient.init({ id: user.id, name: user.name ?? null, avatar: null });
    realtimeClient.connect(room);
    // Refcounted room subscription — leaving the chat must not kill the socket
    // the community list (or another screen) is still listening on.
    const unsubRoom = realtimeClient.subscribe(room);

    const unsubscribes: Array<() => void> = [];

    // ── New message ────────────────────────────────────────────────────────
    // The fan-out echo also confirms one of our own optimistic bubbles, so it
    // is paired with `pickOptimisticMatch` instead of being appended blindly:
    // several sends can be in flight at once and their echoes interleave, so
    // the row whose text matches wins.
    //
    // The published payload is flat — `sender_name` / `sender_avatar_url` /
    // `reply_sender_name` rather than a hydrated `users` object — so the sender
    // and reply preview are rebuilt here exactly as the web client does.
    unsubscribes.push(
      realtimeClient.on(room, 'message', (data) => {
        const row = data as {
          id: string;
          community_id: string;
          user_id: string;
          sender_name?: string | null;
          sender_avatar_url?: string | null;
          content: string | null;
          created_at: string;
          reply_to_id: string | null;
          reply_sender_name?: string | null;
          image_url: string | null;
          edited_at?: string | null;
          mentions?: Message['mentions'];
        };

        setMessages((prev) => {
          if (prev.some((m) => m.id === row.id)) return prev;

          const matchedTemp = pickOptimisticMatch(prev, {
            user_id: row.user_id,
            content: row.content,
          });
          const withoutTemp = matchedTemp
            ? prev.filter((m) => m.id !== matchedTemp.id)
            : prev;

          // Prefer the server-published name/avatar (no round trip); fall back
          // to the last message we saw from this author so the bubble never
          // reads "Unknown" while a profile fetch would have been pending.
          const users: Message['users'] =
            (row.sender_name
              ? { name: row.sender_name, avatar_url: row.sender_avatar_url ?? null, designation: null }
              : null) ?? prev.find((m) => m.user_id === row.user_id && m.users)?.users ?? null;

          let replyTo: Message['reply_to'] = null;
          if (row.reply_to_id) {
            if (matchedTemp?.reply_to) {
              replyTo = matchedTemp.reply_to;
            } else {
              const parentInState = prev.find((m) => m.id === row.reply_to_id);
              if (parentInState) {
                replyTo = {
                  id: parentInState.id,
                  content: parentInState.content ?? '',
                  user_name: parentInState.users?.name ?? 'Unknown',
                  user_id: parentInState.user_id,
                };
              } else if (row.reply_sender_name) {
                replyTo = {
                  id: row.reply_to_id,
                  content: '',
                  user_name: row.reply_sender_name,
                  user_id: null,
                };
              }
            }
          }

          const incoming: Message = {
            id: row.id,
            content: row.content,
            created_at: row.created_at,
            user_id: row.user_id,
            reply_to_id: row.reply_to_id ?? null,
            image_url: isLocalUri(matchedTemp?.image_url)
              ? (matchedTemp?.image_url ?? null)
              : row.image_url ?? null,
            deleted_at: null,
            edited_at: row.edited_at ?? null,
            mentions: row.mentions ?? [],
            users,
            reactions: [],
            reply_to: replyTo,
            status: 'sent',
          };

          return [...withoutTemp, incoming].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
          );
        });
        if (row.user_id !== user.id) {
          markRead(communityId).catch(() => {});
        }
      }),
    );

    // Message edit
    unsubscribes.push(
      realtimeClient.on(room, 'message-edit', (data) => {
        const row = data as {
          id: string;
          content: string;
          edited_at: string | null;
        };
        setMessages((prev) =>
          prev.map((m) =>
            m.id === row.id
              ? { ...m, content: row.content, edited_at: row.edited_at }
              : m
          )
        );
      }),
    );

    // Message soft-delete
    unsubscribes.push(
      realtimeClient.on(room, 'message-delete', (data) => {
        const row = data as {
          id: string;
          deleted_at: string | null;
        };
        if (!row.deleted_at) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === row.id
              ? { ...m, deleted_at: row.deleted_at, content: '', image_url: null, reply_to: null, reactions: [] }
              : m
          )
        );
      }),
    );

    // Reaction insert/update/delete
    unsubscribes.push(
      realtimeClient.on(room, 'reaction-insert', (data) => {
        const r = data as { message_id: string; user_id: string; emoji: string };
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== r.message_id) return m;
            let reactions = [...m.reactions];
            const idx = reactions.findIndex((rx) => rx.emoji === r.emoji);
            if (idx === -1) {
              reactions.push({ emoji: r.emoji, user_ids: [r.user_id] });
            } else if (!reactions[idx].user_ids.includes(r.user_id)) {
              reactions[idx] = {
                ...reactions[idx],
                user_ids: [...reactions[idx].user_ids, r.user_id],
              };
            }
            return { ...m, reactions };
          })
        );
      }),
    );

    unsubscribes.push(
      realtimeClient.on(room, 'reaction-update', (data) => {
        const { old: oldR, new: newR } = data as {
          old: { message_id: string; user_id: string; emoji: string };
          new: { message_id: string; user_id: string; emoji: string };
        };
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== newR.message_id) return m;
            let reactions = [...m.reactions];
            const oldIdx = reactions.findIndex((rx) => rx.emoji === oldR.emoji);
            if (oldIdx !== -1) {
              const updated = reactions[oldIdx].user_ids.filter((uid) => uid !== oldR.user_id);
              if (updated.length === 0) {
                reactions = reactions.filter((_, i) => i !== oldIdx);
              } else {
                reactions[oldIdx] = { ...reactions[oldIdx], user_ids: updated };
              }
            }
            const newIdx = reactions.findIndex((rx) => rx.emoji === newR.emoji);
            if (newIdx === -1) {
              reactions.push({ emoji: newR.emoji, user_ids: [newR.user_id] });
            } else if (!reactions[newIdx].user_ids.includes(newR.user_id)) {
              reactions[newIdx] = {
                ...reactions[newIdx],
                user_ids: [...reactions[newIdx].user_ids, newR.user_id],
              };
            }
            return { ...m, reactions };
          })
        );
      }),
    );

    unsubscribes.push(
      realtimeClient.on(room, 'reaction-delete', (data) => {
        const r = data as { message_id: string; user_id: string; emoji: string };
        if (!r.message_id || !r.user_id || !r.emoji) return;
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== r.message_id) return m;
            let reactions = [...m.reactions];
            const idx = reactions.findIndex((rx) => rx.emoji === r.emoji);
            if (idx === -1) return m;
            const updated = reactions[idx].user_ids.filter((uid) => uid !== r.user_id);
            if (updated.length === 0) {
              reactions = reactions.filter((_, i) => i !== idx);
            } else {
              reactions[idx] = { ...reactions[idx], user_ids: updated };
            }
            return { ...m, reactions };
          })
        );
      }),
    );

    return () => {
      unsubscribes.forEach((unsub) => unsub());
      unsubRoom();
    };
  }, [communityId, user?.id, user?.name]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    messages,
    setMessages,
    isLoading,
    isLoadingMore,
    hasMore,
    error,
    reload: load,
    loadMore,
    appendMessage,
    updateReactions,
    softDeleteMessage,
    patchMessage,
  };
}
