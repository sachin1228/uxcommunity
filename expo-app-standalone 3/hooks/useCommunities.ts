/**
 * useCommunities — complete port of web's sidebar logic:
 *   useSidebarCommunities + useSidebarRealtime + useSidebarTyping
 *
 * Parity with web:
 * - Bubble-to-top: community moves to position 0 on any new message (WhatsApp UX)
 * - Unread increment: skips own messages and the currently-open community
 * - markCommunityRead: zeroes locally + persists via PATCH /api/communities/:id/read
 * - Sender name resolution: async fetch /api/communities/:id/members/:uid (cached)
 * - Reply-to user resolution: async fetch parent message for reply preview
 * - Reaction preview: async fetch message content for accurate snippet
 * - Reaction name resolution: async fetch reactor's name
 * - Out-of-order reaction guard: skip if existing lastReaction is newer
 * - is_archived: false forced on new message arrival
 * - Separate reaction INSERT / UPDATE / DELETE handlers (matches web)
 * - Subscriptions keyed on sorted IDs string (not length)
 * - Background reconciliation on AppState 'active': max(server, local) unread
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { supabase } from '@/lib/supabase';
import { getCommunities, markRead, Community, LastMessage, LastReaction } from '@/lib/communities';
import { communityStore } from '@/lib/communityStore';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';

// ---------------------------------------------------------------------------
// Typing state
// ---------------------------------------------------------------------------

export interface TypingEntry {
  user_id: string;
  name: string;
  ts: number;
}
type TypingMap = Record<string, TypingEntry[]>;
const TYPING_EXPIRY_MS = 3500;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sort by last_message.created_at DESC, falling back to joined_at. */
function sortByLastActivity(list: Community[]): Community[] {
  return [...list].sort((a, b) => {
    const ta = a.last_message?.created_at ?? a.joined_at ?? '';
    const tb = b.last_message?.created_at ?? b.joined_at ?? '';
    return tb > ta ? 1 : -1;
  });
}

/** Move one community to position 0, preserving relative order of others. */
function bubbleToTop(list: Community[], communityId: string): Community[] {
  const idx = list.findIndex((c) => c.id === communityId);
  if (idx <= 0) return list;
  return [list[idx], ...list.slice(0, idx), ...list.slice(idx + 1)];
}

/** Build reaction snippet text — mirrors web's reactionPreview(). */
function reactionSnippet(content: string | null | undefined, hasImage: boolean): string {
  if (content) {
    const trimmed = content.slice(0, 40);
    return `"${trimmed}${content.length > 40 ? '…' : ''}"`;
  }
  if (hasImage) return '📷 Photo';
  return 'a message';
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useCommunities() {
  const { user } = useAuth();
  const [communities, setCommunities] = useState<Community[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState<TypingMap>({});

  const channelsRef   = useRef<ReturnType<typeof supabase.channel>[]>([]);
  const typingTimers  = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  /** Cached sender names keyed by user_id — mirrors web's resolvedNames Map. */
  const resolvedNames = useRef(new Map<string, string>());
  const reconcileRef  = useRef(false);

  // ── Name resolution ────────────────────────────────────────────────────────
  const resolveName = useCallback(async (commId: string, uid: string): Promise<string | null> => {
    if (resolvedNames.current.has(uid)) return resolvedNames.current.get(uid) ?? null;
    try {
      const { data } = await apiFetch<{ name?: string }>(`/api/communities/${commId}/members/${uid}`);
      if (data?.name) {
        resolvedNames.current.set(uid, data.name);
        return data.name;
      }
    } catch {}
    return null;
  }, []);

  // ── Initial load ───────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    try {
      const data = await getCommunities();
      setCommunities(sortByLastActivity(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load communities');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── Background reconciliation — mirrors web's revalidateUnreadCounts ───────
  const reconcile = useCallback(async () => {
    if (reconcileRef.current) return;
    reconcileRef.current = true;
    try {
      const fresh = await getCommunities();
      setCommunities((prev) => {
        const prevMap = new Map(prev.map((c) => [c.id, c]));
        const activeId = communityStore.activeCommunityId;
        const merged = fresh.map((server) => {
          const local = prevMap.get(server.id);
          if (!local) return server;
          return {
            ...server,
            unread_count:
              server.id === activeId
                ? 0
                : Math.max(server.unread_count, local.unread_count),
          };
        });
        return sortByLastActivity(merged);
      });
    } catch {
      // silent
    } finally {
      reconcileRef.current = false;
    }
  }, []);

  // ── Realtime subscriptions ─────────────────────────────────────────────────
  const subscribeAll = useCallback(
    (communityIds: string[]) => {
      channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
      channelsRef.current = [];

      communityIds.forEach((cid) => {
        const panel = supabase
          .channel(`panel:${cid}`)

          // ── New message ───────────────────────────────────────────────────
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'community_messages', filter: `community_id=eq.${cid}` },
            (payload) => {
              const row = payload.new as {
                id: string;
                community_id: string;
                content: string | null;
                created_at: string;
                user_id: string;
                reply_to_id?: string | null;
                image_url?: string | null;
              };

              const isOwn   = row.user_id === user?.id;
              const isActive = communityStore.activeCommunityId === cid;
              const knownName = resolvedNames.current.get(row.user_id) ?? null;

              const newMsg: LastMessage = {
                id:           row.id,
                content:      row.content,
                created_at:   row.created_at,
                user:         { name: isOwn ? (user?.name?.split(' ')[0] ?? 'You') : (knownName ?? '') },
                is_reply:     !!row.reply_to_id,
                reply_to_user: null,
              };

              setCommunities((prev) => {
                const patched = prev.map((c) => {
                  if (c.id !== cid) return c;
                  return {
                    ...c,
                    is_archived:   false,
                    lastReaction:  null,
                    last_message:  newMsg,
                    unread_count:  isOwn || isActive ? c.unread_count : c.unread_count + 1,
                  };
                });
                // Bubble to top — mirrors WhatsApp/Telegram UX
                return bubbleToTop(patched, cid);
              });

              // Async: resolve unknown sender name, then patch preview
              if (!isOwn && !resolvedNames.current.has(row.user_id)) {
                const msgAt    = row.created_at;
                const senderId = row.user_id;
                resolveName(cid, senderId).then((name) => {
                  if (!name) return;
                  setCommunities((prev) =>
                    prev.map((c) => {
                      if (c.id !== cid || c.last_message?.created_at !== msgAt) return c;
                      return { ...c, last_message: { ...c.last_message!, user: { name } } };
                    })
                  );
                });
              }

              // Async: resolve reply_to_user for reply messages
              if (row.reply_to_id) {
                const msgAt   = row.created_at;
                const replyId = row.reply_to_id;
                apiFetch<{ user_name?: string }>(`/api/communities/${cid}/messages/${replyId}`)
                  .then(({ data }) => {
                    if (!data?.user_name) return;
                    const firstName = data.user_name.split(' ')[0];
                    setCommunities((prev) =>
                      prev.map((c) => {
                        if (c.id !== cid || c.last_message?.created_at !== msgAt) return c;
                        return { ...c, last_message: { ...c.last_message!, reply_to_user: firstName } };
                      })
                    );
                  })
                  .catch(() => {});
              }
            }
          )

          // ── Soft-delete ───────────────────────────────────────────────────
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'community_messages', filter: `community_id=eq.${cid}` },
            (payload) => {
              const row = payload.new as { created_at: string; deleted_at: string | null };
              if (!row.deleted_at) return;
              setCommunities((prev) =>
                prev.map((c) => {
                  if (c.id !== cid || c.last_message?.created_at !== row.created_at) return c;
                  return { ...c, last_message: { ...c.last_message!, content: null } };
                })
              );
            }
          )

          // ── Reaction added ────────────────────────────────────────────────
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'message_reactions', filter: `community_id=eq.${cid}` },
            (payload) => {
              const r = payload.new as {
                community_id: string; message_id: string;
                user_id: string; emoji: string; created_at?: string;
              };
              const isOwn     = r.user_id === user?.id;
              const knownName = resolvedNames.current.get(r.user_id);

              // Apply with what we know now
              setCommunities((prev) =>
                prev.map((c) => {
                  if (c.id !== cid) return c;
                  // Out-of-order guard — mirror web
                  if (c.lastReaction?.createdAt && r.created_at && c.lastReaction.createdAt > r.created_at) return c;
                  const fallback = c.last_message?.id === r.message_id ? c.last_message : null;
                  return {
                    ...c,
                    lastReaction: {
                      messageId:    r.message_id,
                      emoji:        r.emoji,
                      createdAt:    r.created_at ?? new Date().toISOString(),
                      firstName:    isOwn ? 'You' : (knownName?.split(' ')[0] ?? 'Someone'),
                      isOwn,
                      messagePreview: reactionSnippet(fallback?.content, false),
                    } as LastReaction,
                  };
                })
              );

              // Async: fetch message content for accurate snippet
              apiFetch<{ content?: string | null; image_url?: string | null }>(
                `/api/communities/${cid}/messages/${r.message_id}`
              )
                .then(({ data: msg }) => {
                  const preview = reactionSnippet(msg?.content, !!msg?.image_url);
                  const rAt = r.created_at;
                  setCommunities((prev) =>
                    prev.map((c) => {
                      if (c.id !== cid || !c.lastReaction) return c;
                      if (c.lastReaction.messageId !== r.message_id || c.lastReaction.emoji !== r.emoji || c.lastReaction.createdAt !== rAt) return c;
                      return { ...c, lastReaction: { ...c.lastReaction!, messagePreview: preview } };
                    })
                  );
                })
                .catch(() => {});

              // Async: resolve reactor name
              if (!isOwn && !resolvedNames.current.has(r.user_id)) {
                const msgId = r.message_id;
                const rEmoji = r.emoji;
                const rAt   = r.created_at;
                resolveName(cid, r.user_id).then((name) => {
                  if (!name) return;
                  setCommunities((prev) =>
                    prev.map((c) => {
                      if (c.id !== cid || !c.lastReaction) return c;
                      if (c.lastReaction.messageId !== msgId || c.lastReaction.emoji !== rEmoji || c.lastReaction.createdAt !== rAt) return c;
                      return { ...c, lastReaction: { ...c.lastReaction!, firstName: name.split(' ')[0] } };
                    })
                  );
                });
              }
            }
          )

          // ── Reaction updated ──────────────────────────────────────────────
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'message_reactions', filter: `community_id=eq.${cid}` },
            (payload) => {
              const r = payload.new as {
                community_id: string; message_id: string;
                user_id: string; emoji: string; created_at?: string;
              };
              const isOwn     = r.user_id === user?.id;
              const knownName = resolvedNames.current.get(r.user_id);
              setCommunities((prev) =>
                prev.map((c) => {
                  if (c.id !== cid) return c;
                  if (c.lastReaction?.createdAt && r.created_at && c.lastReaction.createdAt > r.created_at) return c;
                  return {
                    ...c,
                    lastReaction: {
                      messageId:     r.message_id,
                      emoji:         r.emoji,
                      createdAt:     r.created_at ?? new Date().toISOString(),
                      firstName:     isOwn ? 'You' : (knownName?.split(' ')[0] ?? 'Someone'),
                      isOwn,
                      messagePreview: c.lastReaction?.messagePreview ?? 'a message',
                    } as LastReaction,
                  };
                })
              );
            }
          )

          // ── Reaction removed ──────────────────────────────────────────────
          .on(
            'postgres_changes',
            { event: 'DELETE', schema: 'public', table: 'message_reactions', filter: `community_id=eq.${cid}` },
            (payload) => {
              const r = payload.old as {
                message_id?: string; user_id?: string;
                emoji?: string; created_at?: string;
              };
              if (!r.message_id || !r.emoji) return;
              setCommunities((prev) =>
                prev.map((c) => {
                  if (c.id !== cid || !c.lastReaction) return c;
                  if (c.lastReaction.messageId === r.message_id && c.lastReaction.emoji === r.emoji) {
                    return { ...c, lastReaction: null };
                  }
                  return c;
                })
              );
            }
          )

          .subscribe();

        // ── Typing broadcast ──────────────────────────────────────────────
        const typingCh = supabase
          .channel(`community-typing:${cid}`, {
            config: { broadcast: { ack: false, self: false } },
          })
          .on('broadcast', { event: 'typing' }, ({ payload }) => {
            const { user_id, name, typing: isTyping, ts } = payload as {
              user_id: string; name: string; typing: boolean; ts: number;
            };
            if (user_id === user?.id) return;

            setTyping((prev) => {
              const existing = prev[cid] ?? [];
              const updated: TypingEntry[] = isTyping
                ? [...existing.filter((e) => e.user_id !== user_id), { user_id, name, ts }]
                : existing.filter((e) => e.user_id !== user_id);
              return { ...prev, [cid]: updated };
            });

            const key = `${cid}:${user_id}`;
            clearTimeout(typingTimers.current[key]);
            if (isTyping) {
              typingTimers.current[key] = setTimeout(() => {
                setTyping((prev) => ({
                  ...prev,
                  [cid]: (prev[cid] ?? []).filter((e) => e.user_id !== user_id),
                }));
              }, TYPING_EXPIRY_MS);
            }
          })
          .subscribe();

        channelsRef.current.push(panel, typingCh);
      });
    },
    // user?.id and user?.name are the only user-derived values used inside
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.id, user?.name, resolveName]
  );

  // ── Effects ────────────────────────────────────────────────────────────────

  useEffect(() => { load(); }, [load]);

  // Re-subscribe whenever the set of community IDs changes or user loads
  useEffect(() => {
    if (communities.length === 0) return;
    const ids = communities.map((c) => c.id).sort();
    subscribeAll(ids);
    return () => {
      channelsRef.current.forEach((ch) => supabase.removeChannel(ch));
      channelsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    // eslint-disable-next-line react-hooks/exhaustive-deps
    communities.map((c) => c.id).sort().join(','),
    subscribeAll,
  ]);

  // Background reconciliation when app is foregrounded
  useEffect(() => {
    const handle = (state: AppStateStatus) => { if (state === 'active') reconcile(); };
    const sub = AppState.addEventListener('change', handle);
    return () => sub.remove();
  }, [reconcile]);

  // ── Actions ────────────────────────────────────────────────────────────────

  /**
   * Call on entering a community chat.
   * Zeros badge locally, persists to server, guards realtime increment.
   */
  const markCommunityRead = useCallback((communityId: string) => {
    communityStore.activeCommunityId = communityId;
    setCommunities((prev) =>
      prev.map((c) => (c.id === communityId ? { ...c, unread_count: 0 } : c))
    );
    markRead(communityId).catch(() => {});
  }, []);

  /** Call on leaving a community chat (unmount). */
  const clearActiveCommunity = useCallback(() => {
    communityStore.activeCommunityId = null;
  }, []);

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

  return {
    communities,
    isLoading,
    error,
    reload: load,
    markCommunityRead,
    clearActiveCommunity,
    getTypingLabel,
  };
}
