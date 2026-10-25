/**
 * The community chat's "created a …" content cards: the window plus
 * everything that keeps it live. Mirror of the web's useContentTimeline +
 * the content-event half of useRealtimeChat:
 *
 * - History: account-scoped disk snapshots paint first. A cold chat without a
 *   message window shares one /bootstrap request with useChatMessages; when
 *   messages are cached but cards expired, a content-only bootstrap section
 *   avoids downloading the latest message page again. Card snapshots expire
 *   after 15 minutes because their missed updates have no message cursor.
 *   Reconnects and foregrounds do not refetch the card window.
 * - Realtime: the chat room's content-insert / content-delete / content-comment
 *   / content-reaction-* topics, so a card is as permanent and as current as a
 *   message — not a session-only bubble.
 * - Local mirror: creates/deletes from the mounted tabs land in the same
 *   frame via lib/contentEventMirror.ts, ahead of the realtime echo.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { realtimeClient, realtimeRooms } from '@/lib/realtime';
import { getMemberBrief, markRead, type Message } from '@/lib/communities';
import {
  fetchCommunityBootstrap,
  fetchCommunityContentEvents,
  getCachedCommunityContentEvents,
  patchCachedBootstrapContentEvents,
} from '@/lib/communityBootstrap';
import { scheduleMarkRead } from '@/lib/readManager';
import { chatCache } from '@/lib/chatCacheStore';
import { applyReactionDelete, applyReactionInsert, type Reaction } from '@/lib/chat';
import {
  createAuthorCache,
  type ChatContentEvent,
  type ChatContentKind,
  type ChatContentEventMeta,
} from '@/lib/chatContentEvents';
import { subscribeContentEvents } from '@/lib/contentEventMirror';
import { useAuth } from '@/context/AuthContext';

function byCreatedAt(a: { created_at: string }, b: { created_at: string }) {
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

/** Realtime payload of the chat room's content-insert topic. */
interface ContentInsertRow {
  id?: string;
  community_id?: string;
  user_id?: string;
  kind?: ChatContentKind;
  title?: string;
  created_at?: string;
  meta?: ChatContentEventMeta | null;
}

export function useChatContentEvents(communityId: string) {
  const { user } = useAuth();
  const [events, setEvents] = useState<ChatContentEvent[]>(
    () => user?.id
      ? getCachedCommunityContentEvents(communityId, user.id) ?? []
      : [],
  );
  /** True once the history fetch has settled — gates the empty-state copy. */
  const [ready, setReady] = useState(() => user?.id
    ? getCachedCommunityContentEvents(communityId, user.id) !== null
    : false);
  /**
   * True once the disk read has settled. Persistence waits for it: a failed
   * fetch must not write an empty list over the cards still being read back.
   */
  const [cacheHydrated, setCacheHydrated] = useState(false);

  const communityIdRef = useRef(communityId);
  const userIdRef = useRef(user?.id);
  /** True once the bootstrap answered; the disk snapshot must not overwrite it. */
  const networkSettledRef = useRef(
    user?.id ? getCachedCommunityContentEvents(communityId, user.id) !== null : false,
  );
  const cacheReadRef = useRef<{
    communityId: string;
    userId: string | undefined;
    events: Promise<ChatContentEvent[] | null>;
    messages: Promise<Message[] | null>;
  } | null>(null);
  useLayoutEffect(() => {
    const changed =
      communityIdRef.current !== communityId || userIdRef.current !== user?.id;
    communityIdRef.current = communityId;
    userIdRef.current = user?.id;
    if (changed) {
      const cached = user?.id
        ? getCachedCommunityContentEvents(communityId, user.id)
        : null;
      networkSettledRef.current = cached !== null;
      setEvents(cached ?? []);
      setReady(cached !== null);
      setCacheHydrated(cached !== null);
    }
  }, [communityId, user?.id]);

  // Cold start: paint the cards cached with the message window while the
  // bootstrap request is in flight (see lib/chatCache.ts).
  useEffect(() => {
    const userId = user?.id;
    const memoryEvents = userId
      ? getCachedCommunityContentEvents(communityId, userId)
      : null;
    if (memoryEvents !== null) {
      networkSettledRef.current = true;
      cacheReadRef.current = {
        communityId,
        userId,
        events: Promise.resolve(memoryEvents),
        messages: Promise.resolve(null),
      };
      setEvents(memoryEvents);
      setReady(true);
      setCacheHydrated(true);
      return undefined;
    }
    networkSettledRef.current = false;
    const eventsPromise = userId
      ? chatCache.loadCommunityEvents(userId, communityId).catch(() => null)
      : Promise.resolve(null);
    const messagesPromise = userId
      ? chatCache.loadCommunityMessages(userId, communityId).catch(() => null)
      : Promise.resolve(null);
    cacheReadRef.current = { communityId, userId, events: eventsPromise, messages: messagesPromise };
    if (!userId) {
      setCacheHydrated(true);
      return undefined;
    }
    let active = true;
    void eventsPromise
      .then((cached) => {
        if (!active || cached === null) return;
        if (networkSettledRef.current) return;
        if (cached.length > 0) {
          setEvents((prev) => {
            if (
              communityIdRef.current !== communityId ||
              userIdRef.current !== userId
            ) return prev;
            const known = new Set(prev.map((event) => event.id));
            const fresh = cached.filter((event) => !known.has(event.id));
            return fresh.length > 0 ? [...prev, ...fresh].sort(byCreatedAt) : prev;
          });
        }
        setReady(true);
      })
      .finally(() => {
        if (active) setCacheHydrated(true);
      });
    return () => {
      active = false;
    };
  }, [communityId, user?.id]);

  /**
   * Authors of live inserts, remembered from resolved rows — the payload
   * carries only a user_id, so the name/avatar are fetched per member once
   * (bounded LRU; the card falls back to "Someone" until it lands).
   */
  const authors = useRef(createAuthorCache());
  const pendingAuthors = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const userId = user?.id;
      const memoryEvents = userId
        ? getCachedCommunityContentEvents(communityId, userId)
        : null;
      if (
        communityIdRef.current !== communityId ||
        userIdRef.current !== userId
      ) return;
      if (memoryEvents !== null) {
        networkSettledRef.current = true;
        setEvents(memoryEvents);
        setReady(true);
        return;
      }
      const cacheRead = cacheReadRef.current;
      let diskEvents: ChatContentEvent[] | null = null;
      let diskMessages: Message[] | null = null;
      if (cacheRead?.communityId === communityId && cacheRead.userId === userId) {
        [diskEvents, diskMessages] = await Promise.all([cacheRead.events, cacheRead.messages]);
      }
      if (
        communityIdRef.current !== communityId ||
        userIdRef.current !== userId
      ) return;
      // A recent account-scoped snapshot is enough to paint this timeline.
      // The messages hook drains its cursor independently; content cards are
      // refreshed from bootstrap after the bounded disk-snapshot TTL expires.
      if (diskEvents !== null) {
        setReady(true);
        return;
      }

      if (diskMessages?.length) {
        const contentEvents = await fetchCommunityContentEvents(communityId, userId);
        if (
          communityIdRef.current !== communityId ||
          userIdRef.current !== userId
        ) return;
        networkSettledRef.current = true;
        for (const row of contentEvents) {
          if (row.users) authors.current.set(row.user_id, row.users);
        }
        setEvents(contentEvents);
        return;
      }

      // The shared bootstrap (see lib/communityBootstrap.ts) — the same
      // request the messages hook reads, so the two sections come from one
      // Worker invocation.
      const bootstrap = await fetchCommunityBootstrap(communityId, userId);
      // The user switched communities while the page was in flight.
      if (
        communityIdRef.current !== communityId ||
        userIdRef.current !== userId
      ) return;
      // Only a successful answer is authoritative; a failed fetch must leave
      // a still-pending disk read free to paint the cached cards.
      networkSettledRef.current = true;
      for (const row of bootstrap.contentEvents) {
        if (row.users) authors.current.set(row.user_id, row.users);
      }
      setEvents(bootstrap.contentEvents);
    } catch {
      // Keep whatever is on screen; realtime and the next open reconcile.
    } finally {
      if (
        communityIdRef.current === communityId &&
        userIdRef.current === user?.id
      ) setReady(true);
    }
  }, [communityId, user?.id]);

  useEffect(() => {
    load();
  }, [load]);

  // Write-through so the next cold start paints the same cards (and a card
  // created/deleted while the chat was open is reflected immediately).
  useEffect(() => {
    if (!user?.id || !ready || !cacheHydrated) return;
    // On an in-place community switch the previous render's events still sit
    // in state for one commit — never file them under the new room's key.
    if (events.some((event) => event.community_id && event.community_id !== communityId)) {
      return;
    }
    void chatCache.saveCommunityEvents(user.id, communityId, events);
  }, [cacheHydrated, communityId, events, ready, user?.id]);

  // Live creates/deletes from the mounted tabs, mirrored ahead of realtime.
  useEffect(() => {
    return subscribeContentEvents((change) => {
      if (change.communityId !== communityId) return;
      if (change.kind === 'delete') {
        setEvents((prev) => prev.filter((event) => event.id !== change.id));
        return;
      }
      const created = change.event;
      if (created.users) authors.current.set(created.user_id, created.users);
      setEvents((prev) => {
        if (prev.some((event) => event.id === created.id)) return prev;
        return [...prev, created].sort(byCreatedAt);
      });
    });
  }, [communityId]);

  useEffect(() => {
    if (!user?.id) return;

    const room = realtimeRooms.chat(communityId);
    realtimeClient.init({ id: user.id, name: user.name ?? null, avatar: null });
    realtimeClient.connect(room);
    // Refcounted room subscription — the chat's message hook holds its own.
    const unsubRoom = realtimeClient.subscribe(room);
    const unsubscribes: Array<() => void> = [];

    /**
     * Resolve a card author from the member endpoint, once per id, then patch
     * the cards already on screen that are still waiting for the name.
     */
    const resolveAuthor = (uid: string) => {
      const cached = authors.current.get(uid);
      if (cached) return cached;
      if (pendingAuthors.current.has(uid)) return null;
      pendingAuthors.current.add(uid);
      void getMemberBrief(communityId, uid)
        .then((brief) => {
          if (!brief) return;
          authors.current.set(uid, brief);
          setEvents((prev) =>
            prev.map((event) =>
              event.user_id === uid && !event.users ? { ...event, users: brief } : event,
            ),
          );
        })
        .finally(() => pendingAuthors.current.delete(uid));
      return null;
    };

    // ── New content (threads / showcase / resources / events) ──────────────
    unsubscribes.push(
      realtimeClient.on(room, 'content-insert', (data) => {
        const row = data as ContentInsertRow;
        if (!row.id || !row.user_id || !row.created_at || !row.kind) return;
        if (row.community_id && row.community_id !== communityId) return;

        const users =
          row.user_id === user.id
            ? { name: user.name ?? 'You', avatar_url: user.avatar_url ?? null }
            : resolveAuthor(row.user_id);
        const event: ChatContentEvent = {
          id: row.id,
          community_id: row.community_id ?? communityId,
          user_id: row.user_id,
          kind: row.kind,
          title: row.title ?? '',
          created_at: row.created_at,
          meta: row.meta ?? null,
          reactions: [],
          users,
        };
        // The shared bootstrap is reused for 15 minutes: fold the live card
        // into it so leaving and re-entering the chat inside that window does
        // not paint the fetch-time snapshot and lose this card.
        patchCachedBootstrapContentEvents(communityId, { kind: 'insert', event }, user?.id);
        if (row.user_id !== user.id) {
          // The member has the card in front of them — clear the server-side
          // content unread instead of letting it resurface after they leave.
          scheduleMarkRead(communityId, { patch: markRead });
        }
        setEvents((prev) => {
          // The creator's own mirror insert (or a duplicate echo) already has it.
          if (prev.some((entry) => entry.id === event.id)) return prev;
          return [...prev, event].sort(byCreatedAt);
        });
      }),
    );

    // ── Content removed (by its author, or by moderation) ──────────────────
    unsubscribes.push(
      realtimeClient.on(room, 'content-delete', (data) => {
        const row = data as { id?: string };
        if (!row.id) return;
        // Drop it from the shared bootstrap as well — otherwise re-entering
        // the chat inside its 15-minute window resurrects the deleted card.
        patchCachedBootstrapContentEvents(communityId, { kind: 'delete', id: row.id }, user?.id);
        setEvents((prev) => prev.filter((event) => event.id !== row.id));
      }),
    );

    // ── Comment totals on the cards ────────────────────────────────────────
    // Comment APIs recount the item and broadcast the absolute total, so the
    // card's "💬 n" grows while members sit in the chat.
    unsubscribes.push(
      realtimeClient.on(room, 'content-comment', (data) => {
        const row = data as { content_id?: string; comment_count?: number };
        if (!row.content_id || typeof row.comment_count !== 'number') return;
        const id = row.content_id;
        const count = row.comment_count;
        setEvents((prev) => {
          let changed = false;
          const next = prev.map((event) => {
            if (event.id !== id) return event;
            if ((event.meta?.comment_count ?? 0) === count) return event;
            changed = true;
            return { ...event, meta: { ...(event.meta ?? {}), comment_count: count } };
          });
          return changed ? next : prev;
        });
      }),
    );

    // ── Card reactions ─────────────────────────────────────────────────────
    // The toggle API broadcasts insert/update/delete transitions; applying
    // them to the cached card keeps every member's pills in sync. Kind is part
    // of the match — ids are unique today, but the web contract carries it.
    const applyContentReaction = (
      contentId: string,
      kind: ChatContentKind,
      userId: string,
      emoji: string | null,
      previousEmoji?: string | null,
    ) => {
      setEvents((prev) =>
        prev.map((event) => {
          if (event.id !== contentId || event.kind !== kind) return event;
          let reactions = [...(event.reactions ?? [])];
          if (previousEmoji) {
            reactions = applyReactionDelete(reactions, previousEmoji, userId);
          }
          if (emoji) {
            reactions = applyReactionInsert(reactions, emoji, userId);
          }
          return { ...event, reactions };
        }),
      );
    };

    unsubscribes.push(
      realtimeClient.on(room, 'content-reaction-insert', (data) => {
        const row = data as {
          content_id?: string;
          kind?: ChatContentKind;
          user_id?: string;
          emoji?: string;
        };
        if (!row.content_id || !row.kind || !row.user_id || !row.emoji) return;
        applyContentReaction(row.content_id, row.kind, row.user_id, row.emoji);
      }),
    );

    unsubscribes.push(
      realtimeClient.on(room, 'content-reaction-update', (data) => {
        const row = data as {
          old?: { content_id?: string; kind?: ChatContentKind; user_id?: string; emoji?: string };
          new?: { emoji?: string };
        };
        const oldRow = row.old;
        if (!oldRow?.content_id || !oldRow.kind || !oldRow.user_id || !row.new?.emoji) return;
        applyContentReaction(
          oldRow.content_id,
          oldRow.kind,
          oldRow.user_id,
          row.new.emoji,
          oldRow.emoji,
        );
      }),
    );

    unsubscribes.push(
      realtimeClient.on(room, 'content-reaction-delete', (data) => {
        const row = data as {
          content_id?: string;
          kind?: ChatContentKind;
          user_id?: string;
          emoji?: string;
        };
        if (!row.content_id || !row.kind || !row.user_id || !row.emoji) return;
        applyContentReaction(row.content_id, row.kind, row.user_id, null, row.emoji);
      }),
    );

    return () => {
      unsubscribes.forEach((unsub) => unsub());
      unsubRoom();
    };
  }, [communityId, user?.id, user?.name, user?.avatar_url]);

  /** Paint the server-confirmed (or optimistically projected) pill state. */
  const applyContentReactions = useCallback(
    (contentId: string, kind: ChatContentKind, reactions: Reaction[]) => {
      setEvents((prev) => {
        let changed = false;
        const next = prev.map((event) => {
          if (event.id !== contentId || event.kind !== kind) return event;
          changed = true;
          return { ...event, reactions };
        });
        return changed ? next : prev;
      });
    },
    [],
  );

  return { events, ready, applyContentReactions, reload: load };
}
