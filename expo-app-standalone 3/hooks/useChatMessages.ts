/**
 * Loads and keeps messages live for a single community chat.
 * - Initial load: last 50 messages via GET /api/communities/:id/messages
 * - Pagination: older messages via ?before=<ISO>
 * - Realtime: Supabase postgres_changes on community_messages + message_reactions
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
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
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

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

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`chat:${communityId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'community_messages',
          filter: `community_id=eq.${communityId}`,
        },
        (payload) => {
          const row = payload.new as Message;
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
          if (row.user_id !== user?.id) {
            markRead(communityId).catch(() => {});
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'community_messages',
          filter: `community_id=eq.${communityId}`,
        },
        (payload) => {
          const row = payload.new as Message;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === row.id
                ? { ...m, content: row.content, deleted_at: row.deleted_at, image_url: row.image_url }
                : m
            )
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'message_reactions',
          filter: `community_id=eq.${communityId}`,
        },
        (payload) => {
          const row = (payload.new ?? payload.old) as {
            message_id: string;
            user_id: string;
            emoji: string;
          };

          // Rebuild reactions optimistically from the event
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== row.message_id) return m;

              let reactions = [...m.reactions];
              const idx = reactions.findIndex((r) => r.emoji === row.emoji);

              if (payload.eventType === 'DELETE') {
                if (idx === -1) return m;
                const updated = reactions[idx].user_ids.filter((uid) => uid !== row.user_id);
                if (updated.length === 0) {
                  reactions = reactions.filter((_, i) => i !== idx);
                } else {
                  reactions[idx] = { ...reactions[idx], user_ids: updated };
                }
              } else {
                // INSERT or UPDATE — toggle/add
                if (idx === -1) {
                  reactions.push({ emoji: row.emoji, user_ids: [row.user_id] });
                } else if (!reactions[idx].user_ids.includes(row.user_id)) {
                  reactions[idx] = {
                    ...reactions[idx],
                    user_ids: [...reactions[idx].user_ids, row.user_id],
                  };
                }
              }
              return { ...m, reactions };
            })
          );
        }
      )
      .subscribe();

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
    };
  }, [communityId, user?.id]);

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
