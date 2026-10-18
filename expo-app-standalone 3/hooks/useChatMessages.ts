/**
 * Loads and keeps messages live for a single community chat.
 * - Initial load: the shared bootstrap page (GET /api/communities/:id/bootstrap,
 *   reused inside its freshness window — see lib/communityBootstrap.ts)
 * - Pagination: older messages via ?before=<ISO>
 * - Realtime: Cloudflare Durable Object WebSocket (message, message-edit,
 *   message-delete, reaction-insert/update/delete)
 * - Catch-up: every open (and every reconnect / return to the foreground) the
 *   hook asks the API for everything after its newest real message
 *   (?after=<ISO>) and merges it without duplicates. The open is the important
 *   one: the communities list keeps this room's socket alive, so re-entering
 *   the chat fires no status event — and a re-entry inside the bootstrap
 *   cache's window would otherwise paint the fetch-time snapshot.
 * - While open, the screen's window is folded back into that cache
 *   (patchCachedBootstrapMessages) so the next open starts from what the user
 *   just saw, not from the snapshot.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { realtimeClient, realtimeRooms } from '@/lib/realtime';
import {
  getMessages,
  markRead,
  Message,
  Reaction,
} from '@/lib/communities';
import { scheduleMarkRead } from '@/lib/readManager';
import {
  fetchCommunityBootstrap,
  patchCachedBootstrapMessages,
} from '@/lib/communityBootstrap';
import { pickOptimisticMatch, compareChatTimeline } from '@/lib/chat';
import { chatCache } from '@/lib/chatCacheStore';
import type { ChatContentKind } from '@/lib/chatContentEvents';
import {
  createCatchUpScheduler,
  latestMessageCursor,
  mergeCaughtUpMessages,
} from '@/lib/realtimeCatchUp';
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

  // Latest list for the catch-up cursor. Read when the fetch actually runs (not
  // when it is scheduled), so a burst of triggers uses the newest cursor and
  // cannot request the same gap twice.
  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  /** Guards a catch-up that is still in flight when the user switches chat. */
  const communityIdRef = useRef(communityId);
  useEffect(() => {
    communityIdRef.current = communityId;
  }, [communityId]);

  /**
   * The community whose rows the on-screen window belongs to. Seeded with the
   * mount id so realtime rows that land during the first fetch survive the
   * load merge; on a switch without a remount it keeps pointing at the
   * outgoing community until the new page lands, so one community's rows can
   * never merge into — or be cached as — another's.
   */
  const windowCommunityRef = useRef(communityId);

  /**
   * Cold start: paint the window the previous session ended on while the
   * bootstrap request is in flight. The fetch below merges over it, and the
   * mount catch-up closes the gap — the same "local store first, sync after"
   * order messaging apps use.
   */
  useEffect(() => {
    const userId = user?.id;
    if (!userId) return undefined;
    let active = true;
    void chatCache.loadCommunityMessages(userId, communityId).then((cached) => {
      if (!active || !cached || cached.length === 0) return;
      // Plain id-dedupe: unlike the catch-up merge this must never "confirm" an
      // in-flight optimistic bubble, or an old cached row with the same text
      // would remove the message the member just sent.
      setMessages((prev) => {
        const known = new Set(prev.map((message) => message.id));
        const fresh = cached.filter((message) => !known.has(message.id));
        return fresh.length > 0
          ? [...prev, ...fresh].sort(compareChatTimeline)
          : prev;
      });
    });
    return () => {
      active = false;
    };
  }, [communityId, user?.id]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore || messages.length === 0) return;
    const oldest = messages[0]?.created_at;
    if (!oldest) return;
    setIsLoadingMore(true);
    try {
      const older = await getMessages(communityId, oldest);
      // The `before` cursor is timestamp-only, so equal-timestamp rows are
      // re-included by design (see the messages API) — dedupe against what is
      // already on screen before prepending, or the FlatList sees duplicate keys.
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        const fresh = older.filter((m) => !known.has(m.id));
        return fresh.length > 0 ? [...fresh, ...prev] : prev;
      });
      setHasMore(older.length === 50);
    } catch {
      // silent — user can scroll again
    } finally {
      setIsLoadingMore(false);
    }
  }, [communityId, messages, isLoadingMore, hasMore]);

  /**
   * Catch up on anything this client is missing: published while the socket
   * was down, or since the loaded snapshot (`load()` schedules one on every
   * open, because an already-live socket fires no status event).
   *
   * Debounced and single-flight: the reconnect signal, the load, the foreground
   * probe and the heartbeat recycle routinely fire within a second of each
   * other, and one `?after=` page is enough to cover all of them.
   */
  const catchUp = useMemo(() => {
    const targetCommunityId = communityId;
    return createCatchUpScheduler(async () => {
      const cursor = latestMessageCursor(messagesRef.current);
      // Nothing real to anchor the cursor to yet — the initial `load()` is
      // already on its way with a full page.
      if (!cursor) return;
      const missed = await getMessages(targetCommunityId, undefined, cursor);
      // The user switched away while the page was in flight: those rows belong
      // to the community that was on screen, not this one.
      if (communityIdRef.current !== targetCommunityId) return;
      if (missed.length === 0) return;
      setMessages((prev) => mergeCaughtUpMessages(prev, missed));
      // Whatever arrived while the socket was down is on screen now.
      scheduleMarkRead(targetCommunityId, { patch: markRead });
    });
  }, [communityId]);
  useEffect(() => () => catchUp.cancel(), [catchUp]);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // The shared bootstrap: one request at chat open, reused while fresh
      // (see lib/communityBootstrap.ts). Pagination and catch-up below keep
      // using the cheap cursor-based messages endpoint.
      const bootstrap = await fetchCommunityBootstrap(communityId);
      // The user switched communities while the request was in flight — those
      // rows belong to the community that was on screen, not this one.
      if (communityIdRef.current !== communityId) return;
      // Merge, never replace: realtime rows that landed while the request was
      // in flight — and the window a previous visit folded into the cache
      // (the patch effect below) — are newer than the fetched snapshot and
      // must survive it.
      const sameWindow = windowCommunityRef.current === communityId;
      windowCommunityRef.current = communityId;
      setMessages((prev) =>
        mergeCaughtUpMessages(sameWindow ? prev : [], bootstrap.messages)
      );
      // The window may hold more than the fresh page (the cache was patched,
      // or the user paginated back earlier), so `>=` keeps history reachable.
      setHasMore(bootstrap.messages.length >= 50);
      // Opening the chat is a user action — its mark-read bypasses the
      // realtime cooldown so the badge always clears (see lib/readManager).
      scheduleMarkRead(communityId, { bypassCooldown: true, patch: markRead });
      // Close the gap between the snapshot and now on EVERY open, exactly like
      // the web chat's mount catch-up: this room's socket is often already
      // connected (the communities list keeps the live window's sockets
      // open), so mounting fires no status event and nothing else would ask
      // for what was published since the snapshot.
      catchUp.schedule();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load messages');
    } finally {
      setIsLoading(false);
    }
  }, [communityId, catchUp]);

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

  /**
   * Keep the shared bootstrap cache's message window current with what is on
   * screen — the mobile counterpart of the web chat's live msgCache. Leaving
   * and re-entering inside the cache's 15-minute freshness window then paints
   * the rows the user just saw (their own sends included) instead of the
   * fetch-time snapshot; without this they vanished on re-entry until some
   * later reconnect happened to catch up.
   *
   * Optimistic rows are never persisted — a resurrected "sending" bubble could
   * never resolve — and an empty window is never written, because the
   * bootstrap module deliberately refuses to serve one from cache (it would
   * only force the refetch this write exists to avoid).
   */
  useEffect(() => {
    if (windowCommunityRef.current !== communityId) return;
    const rows = messages.filter((message) => !message.id.startsWith('temp-'));
    if (rows.length === 0) return;
    patchCachedBootstrapMessages(communityId, rows);
    // Write-through to the persistent window: a process restart reads this
    // back on mount, so everything the member just saw survives the kill.
    const userId = user?.id;
    if (userId) void chatCache.saveCommunityMessages(userId, communityId, rows);
  }, [communityId, messages, user?.id]);

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
          reply_to_content_id?: string | null;
          reply_content_kind?: string | null;
          reply_content_title?: string | null;
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
            // Replies anchored to a "created a …" card carry the kind + title
            // straight from the broadcast payload (web useRealtimeChat parity).
            reply_to_content:
              row.reply_to_content_id && row.reply_content_kind
                ? {
                    id: row.reply_to_content_id,
                    kind: row.reply_content_kind as ChatContentKind,
                    title: row.reply_content_title ?? '',
                  }
                : null,
            status: 'sent',
          };

          // Optimistic rows pin last (compareChatTimeline): an echo from the
          // other member can land while one of our sends is still in flight,
          // and its device-clock stamp must not sort it into the pile either.
          return [...withoutTemp, incoming].sort(compareChatTimeline);
        });
        if (row.user_id !== user.id) {
          // Debounced + cooldown-gated (lib/readManager): a busy room must not
          // PATCH /read once per incoming message.
          scheduleMarkRead(communityId, { patch: markRead });
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

    // ── Retention sweep ────────────────────────────────────────────────────
    // The scheduled sweep hard-deletes messages older than the 15-day window
    // and tells the room with their cutoff (see the web sweep; the same event
    // reaches this socket). Drop everything before it — otherwise an open
    // screen keeps showing messages that no longer exist for anyone.
    unsubscribes.push(
      realtimeClient.on(room, 'messages-expired', (data) => {
        const { cutoff } = data as { cutoff?: string | null };
        if (!cutoff) return;
        const cutoffMs = Date.parse(cutoff);
        if (Number.isNaN(cutoffMs)) return;
        setMessages((prev) => {
          const next = prev.filter((m) => new Date(m.created_at).getTime() >= cutoffMs);
          return next.length === prev.length ? prev : next;
        });
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

    // ── Gap recovery ───────────────────────────────────────────────────────
    // A socket cannot deliver what was published before it was subscribed, so
    // every open — and most importantly a re-open after a drop (Wi-Fi → LTE, a
    // backgrounded app, a recycled half-open socket) — asks the API for the gap
    // instead of waiting for the next remount.
    unsubscribes.push(
      realtimeClient.onRoomStatus(room, (connected) => {
        if (connected) catchUp.schedule();
      }),
    );
    // Coming back to the foreground probes the socket, but the probe takes up to
    // a heartbeat timeout to conclude the socket is dead — catch up right away
    // instead of waiting for that verdict.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') catchUp.schedule();
    });

    return () => {
      appStateSub.remove();
      catchUp.cancel();
      unsubscribes.forEach((unsub) => unsub());
      unsubRoom();
    };
  }, [communityId, user?.id, user?.name, catchUp]);

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
