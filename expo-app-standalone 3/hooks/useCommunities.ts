/**
 * Fetches the user's communities list and keeps it live via Supabase realtime.
 * Mirrors the web app's useSidebarCommunities + useSidebarRealtime + useSidebarTyping.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { getCommunities, Community, LastMessage, LastReaction } from '@/lib/communities';
import { useAuth } from '@/context/AuthContext';

// Typing state per community
export interface TypingEntry {
  user_id: string;
  name: string;
  ts: number;
}

type TypingMap = Record<string, TypingEntry[]>;

const TYPING_EXPIRY_MS = 3500;

export function useCommunities() {
  const { user } = useAuth();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState<TypingMap>({});
  const channelsRef = useRef<ReturnType<typeof supabase.channel>[]>([]);
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const load = useCallback(async () => {
    try {
      const data = await getCommunities();
      setCommunities(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load communities');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Subscribe to realtime updates for all communities
  const subscribeAll = useCallback(
    (communityIds: string[]) => {
      // Clean up existing subscriptions
      channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
      channelsRef.current = [];

      communityIds.forEach((cid) => {
        // ── postgres_changes: panel:${communityId} ────────────────────────
        const panelChannel = supabase
          .channel(`panel:${cid}`)
          .on(
            'postgres_changes',
            {
              event: 'INSERT',
              schema: 'public',
              table: 'community_messages',
              filter: `community_id=eq.${cid}`,
            },
            (payload) => {
              const row = payload.new as {
                id: string;
                community_id: string;
                content: string | null;
                created_at: string;
                user_id: string;
                reply_to_id?: string;
                image_url?: string;
              };

              setCommunities((prev) =>
                prev.map((c) => {
                  if (c.id !== cid) return c;
                  const isOwnMessage = row.user_id === user?.id;
                  const newLastMessage: LastMessage = {
                    id: row.id,
                    content: row.content,
                    created_at: row.created_at,
                    user: { name: isOwnMessage ? 'You' : '' },
                    is_reply: !!row.reply_to_id,
                    reply_to_user: null,
                  };
                  return {
                    ...c,
                    last_message: newLastMessage,
                    lastReaction: null,
                    unread_count: isOwnMessage ? c.unread_count : c.unread_count + 1,
                  };
                })
              );
            }
          )
          .on(
            'postgres_changes',
            {
              event: 'UPDATE',
              schema: 'public',
              table: 'community_messages',
              filter: `community_id=eq.${cid}`,
            },
            (payload) => {
              const row = payload.new as { community_id: string; deleted_at: string | null };
              if (!row.deleted_at) return;
              // Message soft-deleted — clear last_message preview if it matched
              setCommunities((prev) =>
                prev.map((c) => {
                  if (c.id !== cid) return c;
                  if (c.last_message?.id === (payload.new as { id: string }).id) {
                    return { ...c, last_message: null };
                  }
                  return c;
                })
              );
            }
          )
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'message_reactions',
              filter: `community_id=eq.${cid}`,
            },
            (payload) => {
              const row = (payload.new ?? payload.old) as {
                community_id: string;
                message_id: string;
                user_id: string;
                emoji: string;
                created_at?: string;
              };
              const isOwn = row.user_id === user?.id;

              if (payload.eventType === 'DELETE') {
                setCommunities((prev) =>
                  prev.map((c) => {
                    if (c.id !== cid) return c;
                    if (c.lastReaction?.messageId === row.message_id) {
                      return { ...c, lastReaction: null };
                    }
                    return c;
                  })
                );
              } else {
                const reaction: LastReaction = {
                  messageId: row.message_id,
                  emoji: row.emoji,
                  createdAt: row.created_at ?? new Date().toISOString(),
                  firstName: isOwn ? 'You' : '',
                  isOwn,
                  messagePreview: null,
                };
                setCommunities((prev) =>
                  prev.map((c) => (c.id !== cid ? c : { ...c, lastReaction: reaction }))
                );
              }
            }
          )
          .subscribe();

        // ── Typing broadcast ──────────────────────────────────────────────
        const typingChannel = supabase
          .channel(`community-typing:${cid}`, {
            config: { broadcast: { ack: false, self: false } },
          })
          .on('broadcast', { event: 'typing' }, ({ payload }) => {
            const { user_id, name, typing: isTyping, ts } = payload as {
              user_id: string;
              name: string;
              typing: boolean;
              ts: number;
            };
            if (user_id === user?.id) return;

            setTyping((prev) => {
              const existing = prev[cid] ?? [];
              let updated: TypingEntry[];
              if (isTyping) {
                updated = [
                  ...existing.filter((e) => e.user_id !== user_id),
                  { user_id, name, ts },
                ];
              } else {
                updated = existing.filter((e) => e.user_id !== user_id);
              }
              return { ...prev, [cid]: updated };
            });

            // Auto-expire after TYPING_EXPIRY_MS
            const timerKey = `${cid}:${user_id}`;
            clearTimeout(typingTimers.current[timerKey]);
            if (isTyping) {
              typingTimers.current[timerKey] = setTimeout(() => {
                setTyping((prev) => ({
                  ...prev,
                  [cid]: (prev[cid] ?? []).filter((e) => e.user_id !== user_id),
                }));
              }, TYPING_EXPIRY_MS);
            }
          })
          .subscribe();

        channelsRef.current.push(panelChannel, typingChannel);
      });
    },
    [user?.id]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (communities.length === 0) return;
    const ids = communities.map((c) => c.id);
    subscribeAll(ids);
    return () => {
      channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
      channelsRef.current = [];
    };
  }, [communities.length, subscribeAll]);

  /** Call when entering a community to zero out its unread count locally. */
  const markCommunityRead = useCallback((communityId: string) => {
    setCommunities((prev) =>
      prev.map((c) => (c.id === communityId ? { ...c, unread_count: 0 } : c))
    );
  }, []);

  /** Typing text label for a community (mirrors web logic). */
  const getTypingLabel = useCallback(
    (communityId: string): string | null => {
      const typists = (typing[communityId] ?? []).filter(
        (e) => Date.now() - e.ts < TYPING_EXPIRY_MS
      );
      if (typists.length === 0) return null;
      if (typists.length === 1) return `${typists[0].name} is typing…`;
      if (typists.length === 2) return `${typists[0].name} & ${typists[1].name} are typing…`;
      return 'Several people are typing…';
    },
    [typing]
  );

  return { communities, isLoading, error, reload: load, markCommunityRead, getTypingLabel };
}
