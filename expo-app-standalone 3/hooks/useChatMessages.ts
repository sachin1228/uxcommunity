/**
 * Loads and keeps messages live for a single community chat.
 * - Initial load: last 50 messages via GET /api/communities/:id/messages
 * - Pagination: older messages via ?before=<ISO>
 * - Realtime: Cloudflare Durable Object WebSocket (message, message-edit,
 *   message-delete, reaction-insert/update/delete)
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { RealtimeClient, realtimeRooms } from '@/lib/realtime';
import {
  getMessages,
  markRead,
  Message,
  Reaction,
} from '@/lib/communities';
import { useAuth } from '@/context/AuthContext';

export function useChatMessages(communityId: string) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<RealtimeClient | null>(null);

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
        m.id === messageId ? { ...m, deleted_at: new Date().toISOString() } : m
      )
    );
  }, []);

  // Realtime subscription via Cloudflare
  useEffect(() => {
    if (!user?.id) return;

    const client = new RealtimeClient({
      room: realtimeRooms.chat(communityId),
      user: { id: user.id, name: user.name ?? null, avatar: null },
    });
    clientRef.current = client;

    const unsubscribes: Array<() => void> = [];

    // New message
    unsubscribes.push(
      client.on('message', (data) => {
        const row = data as {
          id: string;
          community_id: string;
          user_id: string;
          content: string;
          created_at: string;
          reply_to_id: string | null;
          image_url: string | null;
        };

        setMessages((prev) => {
          if (prev.some((m) => m.id === row.id)) return prev;
          // Reuse avatar/user info already known from earlier messages
          const knownUser =
            prev.find((m) => m.user_id === row.user_id && m.users)?.users ?? null;
          return [
            ...prev,
            {
              ...row,
              users: knownUser,
              reactions: [],
              reply_to: null,
              deleted_at: null,
            },
          ];
        });
        // Mark read since user is in the chat
        if (row.user_id !== user.id) {
          markRead(communityId).catch(() => {});
        }
      }),
    );

    // Message edit
    unsubscribes.push(
      client.on('message-edit', (data) => {
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
      client.on('message-delete', (data) => {
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
      client.on('reaction-insert', (data) => {
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
      client.on('reaction-update', (data) => {
        const { old: oldR, new: newR } = data as {
          old: { message_id: string; user_id: string; emoji: string };
          new: { message_id: string; user_id: string; emoji: string };
        };
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== newR.message_id) return m;
            let reactions = [...m.reactions];
            // Remove old emoji
            const oldIdx = reactions.findIndex((rx) => rx.emoji === oldR.emoji);
            if (oldIdx !== -1) {
              const updated = reactions[oldIdx].user_ids.filter((uid) => uid !== oldR.user_id);
              if (updated.length === 0) {
                reactions = reactions.filter((_, i) => i !== oldIdx);
              } else {
                reactions[oldIdx] = { ...reactions[oldIdx], user_ids: updated };
              }
            }
            // Add new emoji
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
      client.on('reaction-delete', (data) => {
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

    client.connect();

    return () => {
      unsubscribes.forEach((unsub) => unsub());
      client.close();
      clientRef.current = null;
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
  };
}
