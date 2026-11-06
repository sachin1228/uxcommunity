/**
 * A community's local message window, optimistic sends and live interactions.
 * The shared store receives messages even while this screen is closed. Opening
 * paints it immediately and starts a deduped cursor sync without a debounce.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { realtimeClient, realtimeRooms } from '@/lib/realtime';
import {
  getMessages,
  markRead,
  Message,
  Reaction,
} from '@/lib/communities';
import { scheduleMarkRead } from '@/lib/readManager';
import { recordCommunityReadFloor } from '@/lib/communityReadFloor';
import { communityMessageStore } from '@/lib/communityMessageStoreRuntime';
import { enrichMessagePreviews } from '@/lib/communityMessageStore';
import { pickOptimisticMatch, compareChatTimeline, newestMessageAt } from '@/lib/chat';
import { warmChatMedia } from '@/lib/chatMediaPrefetch';
import type { ChatContentKind } from '@/lib/chatContentEvents';
import {
  mergeCaughtUpMessages,
  mergeMessagePage,
  oldestMessageCursor,
} from '@/lib/realtimeCatchUp';
import { useAuth } from '@/context/AuthContext';

const PAGE_SIZE = 50;

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
  const [messages, setMessages] = useState<Message[]>(
    () => user?.id ? communityMessageStore.peek(user.id, communityId)?.messages ?? [] : [],
  );
  const [isLoading, setIsLoading] = useState(() => {
    const cached = user?.id ? communityMessageStore.peek(user.id, communityId) : null;
    return !cached || (!cached.messages.length && cached.hasMore);
  });
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(() => user?.id
    ? communityMessageStore.peek(user.id, communityId)?.hasMore ?? true : true);
  const [error, setError] = useState<string | null>(null);
  const isLoadingMoreRef = useRef(false);
  const paginationRequestIdRef = useRef(0);

  // Latest list for history pagination and duplicate detection.
  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  /** Guards a catch-up that is still in flight when the user switches chat. */
  const communityIdRef = useRef(communityId);
  const userIdRef = useRef(user?.id);

  /**
   * The community whose rows the on-screen window belongs to. Seeded with the
   * mount id so realtime rows that land during the first fetch survive the
   * load merge; on a switch without a remount it keeps pointing at the
   * outgoing community until the new page lands, so one community's rows can
   * never merge into — or be cached as — another's.
   */
  const windowCommunityRef = useRef(communityId);
  const windowUserIdRef = useRef(user?.id);
  // Capture the owner of THIS render's state. Layout effects update the refs
  // before passive effects run, so reading only the refs could file outgoing
  // rows under the destination room during an in-place navigation.
  const renderedCommunityId = windowCommunityRef.current;
  const renderedUserId = windowUserIdRef.current;
  // Update guards before paint and drop the outgoing window on an in-place
  // room or account switch, so previous rows cannot flash under a new title.
  useLayoutEffect(() => {
    const changed =
      communityIdRef.current !== communityId || userIdRef.current !== user?.id;
    communityIdRef.current = communityId;
    userIdRef.current = user?.id;
    if (!changed) return;
    windowCommunityRef.current = communityId;
    windowUserIdRef.current = user?.id;
    messagesRef.current = [];
    paginationRequestIdRef.current += 1;
    isLoadingMoreRef.current = false;
    const cached = user?.id
      ? communityMessageStore.peek(user.id, communityId)
      : null;
    if (cached) {
      windowCommunityRef.current = communityId;
      windowUserIdRef.current = user?.id;
      setMessages(cached.messages);
      setHasMore(cached.hasMore);
      setIsLoading(!cached.messages.length && cached.hasMore);
    } else {
      setMessages([]);
      setIsLoading(true);
    }
    setIsLoadingMore(false);
    if (!cached) setHasMore(true);
    setError(null);
  }, [communityId, user?.id]);

  const loadMore = useCallback(async () => {
    // A cached window can fire `onEndReached` while its `hasMore` state is
    // still being restored.
    if (isLoading || isLoadingMoreRef.current || !hasMore || messages.length === 0) return;
    const before = oldestMessageCursor(messages);
    if (!before) return;
    const targetCommunityId = communityId;
    const targetUserId = user?.id;
    const requestId = ++paginationRequestIdRef.current;
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);
    try {
      const older = await getMessages(targetCommunityId, before);
      if (
        communityIdRef.current !== targetCommunityId ||
        userIdRef.current !== targetUserId
      ) return;
      // Image sizing warms opportunistically; it never holds a page off screen.
      void warmChatMedia(older).catch(() => {});
      if (
        communityIdRef.current !== targetCommunityId ||
        userIdRef.current !== targetUserId
      ) return;
      const known = new Set(messagesRef.current.map((message) => message.id));
      let freshCount = 0;
      for (const message of older) {
        if (known.has(message.id)) continue;
        known.add(message.id);
        freshCount += 1;
      }
      setMessages((prev) => {
        if (
          communityIdRef.current !== targetCommunityId ||
          userIdRef.current !== targetUserId
        ) return prev;
        return mergeMessagePage(prev, older);
      });
      if (older.length < PAGE_SIZE || (older.length > 0 && freshCount === 0)) {
        setHasMore(false);
      }
    } catch {
      // silent — user can scroll again
    } finally {
      if (requestId === paginationRequestIdRef.current) {
        isLoadingMoreRef.current = false;
      }
      if (
        requestId === paginationRequestIdRef.current &&
        communityIdRef.current === targetCommunityId &&
        userIdRef.current === targetUserId
      ) setIsLoadingMore(false);
    }
  }, [communityId, messages, isLoading, hasMore, user?.id]);

  const catchUp = useCallback(() => {
    if (!user?.id) return;
    // A successful subscribe is a new recovery boundary, including one which
    // finishes after an open-time HTTP snapshot. Coalesce it into one trailing sync.
    void communityMessageStore.sync(user.id, communityId, true).catch(() => {});
  }, [communityId, user?.id]);

  useEffect(() => {
    if (!user?.id) return;
    const owner = user.id;
    const merge = (_?: unknown, source: 'hydrate' | 'sync' | 'live' = 'hydrate') => {
      if (communityIdRef.current !== communityId || userIdRef.current !== owner) return;
      const snapshot = communityMessageStore.peek(owner, communityId);
      if (!snapshot) return;
      setMessages((previous) => {
        const merged = (source === 'hydrate' ? mergeMessagePage : mergeCaughtUpMessages)(previous, snapshot.messages);
        return source === 'sync' ? enrichMessagePreviews(merged, snapshot.messages) : merged;
      });
      if (snapshot.messages.length || !snapshot.hasMore) setIsLoading(false);
    };
    const unsubscribe = communityMessageStore.subscribe(owner, communityId, merge);
    merge();
    return () => { unsubscribe(); communityMessageStore.flush(); };
  }, [communityId, user?.id]);

  const load = useCallback(async () => {
    const owner = user?.id;
    if (!owner) return;
    const current = () => communityIdRef.current === communityId && userIdRef.current === owner;
    setError(null);
    // Opening the chat is reading it: the server marker is scheduled now, not
    // after the message sync — a slow or failed sync must not leave the room
    // unread for the next list read.
    scheduleMarkRead(communityId, {
      bypassCooldown: true, skipIfUpdatedWithinMs: 10_000, patch: markRead,
    });
    try {
      await communityMessageStore.hydrate(owner, communityId);
      if (!current()) return;
      const local = communityMessageStore.peek(owner, communityId);
      setMessages((previous) => mergeMessagePage(previous, local?.messages ?? []));
      if (local) setHasMore(local.hasMore);
      if (local && (local.messages.length || !local.hasMore)) setIsLoading(false);
      await communityMessageStore.sync(owner, communityId);
      if (!current()) return;
      const latest = communityMessageStore.peek(owner, communityId);
      setHasMore(latest?.hasMore ?? true);
      recordCommunityReadFloor(owner, communityId, newestMessageAt(latest?.messages));
    } catch (failure) {
      if (current()) setError(failure instanceof Error ? failure.message : 'Failed to load messages');
    } finally {
      if (current()) setIsLoading(false);
    }
  }, [communityId, user?.id]);

  /** Optimistically append a sent message. */
  const appendMessage = useCallback((msg: Message) => {
    setMessages((prev) => {
      if (prev.some((m) => m.id === msg.id)) return prev;
      return [...prev, msg];
    });
  }, []);

  /** Update reactions on a specific message. */
  const updateReactions = useCallback((messageId: string, reactions: Reaction[]) => {
    if (user?.id) communityMessageStore.update(user.id, communityId, (rows) =>
      rows.map((message) => message.id === messageId ? { ...message, reactions } : message));
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, reactions } : m))
    );
  }, [communityId, user?.id]);

  /** Soft-delete a message locally (mirrors the server setting deleted_at). */
  const softDeleteMessage = useCallback((messageId: string) => {
    if (user?.id) communityMessageStore.update(user.id, communityId, (rows) =>
      rows.map((message) => message.id === messageId
        ? { ...message, deleted_at: new Date().toISOString(), content: null, image_url: null, reply_to: null, reactions: [] }
        : message));
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
  }, [communityId, user?.id]);

  /** Patch one message in place (used by the edit flow). */
  const patchMessage = useCallback((messageId: string, patch: Partial<Message>) => {
    if (user?.id) communityMessageStore.update(user.id, communityId, (rows) =>
      rows.map((message) => message.id === messageId ? { ...message, ...patch } : message));
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, ...patch } : m)));
  }, [communityId, user?.id]);

  // Confirmed POST responses also survive a missed realtime echo. The store
  // keeps its API checkpoint unchanged when remembering these live rows.
  useEffect(() => {
    if (!user?.id || renderedCommunityId !== communityId || renderedUserId !== user.id) return;
    communityMessageStore.remember(user.id, communityId, messages);
  }, [communityId, messages, user?.id, renderedCommunityId, renderedUserId]);

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
          reply_sender_id?: string | null;
          reply_to_content_id?: string | null;
          reply_content_kind?: string | null;
          reply_content_title?: string | null;
          image_url: string | null;
          edited_at?: string | null;
          mentions?: Message['mentions'];
        };

        setMessages((prev) => {
          if (
            communityIdRef.current !== communityId ||
            userIdRef.current !== user?.id ||
            row.community_id !== communityId
          ) return prev;
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
                  user_id: row.reply_sender_id ?? null,
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
          // The row is on screen in the open chat; the list must not re-count
          // it as unread if the PATCH is still inside its cooldown.
          recordCommunityReadFloor(user.id, communityId, row.created_at);
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
        if (!connected) return;
        // Recover even the gap between the HTTP read and the socket opening.
        catchUp();
      }),
    );
    // Coming back to the foreground probes the socket, but the probe takes up to
    // a heartbeat timeout to conclude the socket is dead — catch up right away
    // instead of waiting for that verdict.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') catchUp();
    });

    return () => {
      appStateSub.remove();
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
