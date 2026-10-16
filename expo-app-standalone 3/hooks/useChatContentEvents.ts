/**
 * The community chat's "created a …" content cards: the history window plus
 * everything that keeps it live. Mirror of the web's useContentTimeline +
 * the content-event half of useRealtimeChat:
 *
 * - Initial load: GET /api/communities/:id/content-events (the four kinds'
 *   first page, enriched with authors, reactions, RSVP and comment counts).
 * - Realtime: the chat room's content-insert / content-delete / content-comment
 *   / content-reaction-* topics, so a card is as permanent and as current as a
 *   message — not a session-only bubble.
 * - Gap recovery: a dropped socket misses publishes with no cursor to ask
 *   for, so reconnects and foregrounds re-read the window (debounced).
 * - Local mirror: creates/deletes from the mounted tabs land in the same
 *   frame via lib/contentEventMirror.ts, ahead of the realtime echo.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { realtimeClient, realtimeRooms } from '@/lib/realtime';
import { createCatchUpScheduler } from '@/lib/realtimeCatchUp';
import { getChatContentEvents, getMemberBrief } from '@/lib/communities';
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
  const [events, setEvents] = useState<ChatContentEvent[]>([]);
  /** True once the history fetch has settled — gates the empty-state copy. */
  const [ready, setReady] = useState(false);

  const communityIdRef = useRef(communityId);
  useEffect(() => {
    communityIdRef.current = communityId;
  }, [communityId]);

  /**
   * Authors of live inserts, remembered from resolved rows — the payload
   * carries only a user_id, so the name/avatar are fetched per member once
   * (bounded LRU; the card falls back to "Someone" until it lands).
   */
  const authors = useRef(createAuthorCache());
  const pendingAuthors = useRef(new Set<string>());

  const load = useCallback(async () => {
    try {
      const rows = await getChatContentEvents(communityId);
      // The user switched communities while the page was in flight.
      if (communityIdRef.current !== communityId) return;
      for (const row of rows) {
        if (row.users) authors.current.set(row.user_id, row.users);
      }
      setEvents(rows);
    } catch {
      // Keep whatever is on screen; realtime and the next open reconcile.
    } finally {
      if (communityIdRef.current === communityId) setReady(true);
    }
  }, [communityId]);

  useEffect(() => {
    load();
  }, [load]);

  /**
   * Debounced single-flight re-read for reconnects and foregrounds — the same
   * scheduler the tabs use for realtime gaps (see hooks/useCommunityContent).
   */
  const gapRefetch = useMemo(() => createCatchUpScheduler(load, { debounceMs: 500 }), [load]);
  useEffect(() => () => gapRefetch.cancel(), [gapRefetch]);

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

    // Whatever was published before this socket came up is gone; re-read the
    // window instead of waiting for the next card to arrive.
    unsubscribes.push(
      realtimeClient.onRoomStatus(room, (connected) => {
        if (connected) gapRefetch.schedule();
      }),
    );
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') gapRefetch.schedule();
    });

    return () => {
      appStateSub.remove();
      unsubscribes.forEach((unsub) => unsub());
      unsubRoom();
    };
  }, [communityId, user?.id, user?.name, user?.avatar_url, gapRefetch]);

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
