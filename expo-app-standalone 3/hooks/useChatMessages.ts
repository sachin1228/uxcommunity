/**
 * Loads and keeps messages live for a single community chat.
 * - Initial load: an account-scoped disk window when available, otherwise the
 *   shared bootstrap page (GET /api/communities/:id/bootstrap)
 * - Pagination: older messages via (before, before_id)
 * - Realtime: Cloudflare Durable Object WebSocket (message, message-edit,
 *   message-delete, reaction-insert/update/delete)
 * - Catch-up: every open (and every reconnect / return to the foreground) the
 *   hook asks the API for everything after its newest real message
 *   (after, after_id) and drains missed pages without duplicates. The open is the important
 *   one: the communities list keeps this room's socket alive, so re-entering
 *   the chat fires no status event — and a re-entry inside the bootstrap
 *   cache's window would otherwise paint the fetch-time snapshot.
 * - While open, the screen's window is folded back into that cache
 *   (patchCachedBootstrapMessages) so the next open starts from what the user
 *   just saw, not from the snapshot.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { realtimeClient, realtimeRooms } from '@/lib/realtime';
import {
  getMessages,
  markRead,
  Message,
  MessageCursor,
  Reaction,
} from '@/lib/communities';
import { scheduleMarkRead } from '@/lib/readManager';
import {
  fetchCommunityBootstrap,
  getCachedCommunityMessageWindow,
  patchCachedBootstrapMessages,
  rememberCommunityMessageWindow,
} from '@/lib/communityBootstrap';
import { pickOptimisticMatch, compareChatTimeline } from '@/lib/chat';
import { warmChatMedia } from '@/lib/chatMediaPrefetch';
import { chatCache } from '@/lib/chatCacheStore';
import type { ChatContentKind } from '@/lib/chatContentEvents';
import {
  createCatchUpScheduler,
  drainCatchUpPages,
  latestMessageCursor,
  mergeCaughtUpMessages,
  mergeMessagePage,
  oldestMessageCursor,
} from '@/lib/realtimeCatchUp';
import { useAuth } from '@/context/AuthContext';
import { chatKey } from '../../packages/offline-chat/src';
import {
  getOfflineChat,
  offlineRef,
  onOfflineChatChange,
  onOfflineResume,
} from '@/lib/offline/engine';
import {
  fromLocalChatMessage,
  reconcileMessages,
  toLocalChatMessage,
} from '@/lib/offline/rows';

const PAGE_SIZE = 50;

/**
 * Older history this device already holds, oldest first.
 *
 * Pagination prefers it to the network: a conversation the member has already
 * scrolled (or opened) has those rows in SQLite, and reading them costs a few
 * milliseconds instead of a round trip. An empty list is the signal that the
 * stored window ended, not that the conversation has no older messages.
 */
async function readLocalOlder(
  communityId: string,
  before: MessageCursor,
): Promise<Message[]> {
  const engine = getOfflineChat();
  if (!engine) return [];
  try {
    const rows = await engine.readOlder(
      offlineRef('community', communityId),
      { ts: before.ts, id: before.id },
      PAGE_SIZE,
    );
    return rows.map(fromLocalChatMessage);
  } catch {
    // A local read failure must never stop history from loading.
    return [];
  }
}

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
    () => getCachedCommunityMessageWindow(communityId, user?.id) ?? [],
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const isLoadingMoreRef = useRef(false);
  const paginationRequestIdRef = useRef(0);

  // Latest list for the catch-up cursor. Read when the fetch actually runs (not
  // when it is scheduled), so a burst of triggers uses the newest cursor and
  // cannot request the same gap twice.
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
  const cacheReadRef = useRef<{
    communityId: string;
    userId: string | undefined;
    promise: Promise<Message[] | null>;
  } | null>(null);

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
    openCatchUpRef.current = false;
    openCatchUpAtRef.current = 0;
    paginationRequestIdRef.current += 1;
    isLoadingMoreRef.current = false;
    const cached = user?.id
      ? getCachedCommunityMessageWindow(communityId, user.id)
      : null;
    if (cached) {
      windowCommunityRef.current = communityId;
      windowUserIdRef.current = user?.id;
      setMessages(cached);
      setHasMore(cached.length >= PAGE_SIZE);
      setIsLoading(false);
    } else {
      setMessages([]);
      setIsLoading(true);
    }
    setIsLoadingMore(false);
    if (!cached) setHasMore(true);
    setError(null);
  }, [communityId, user?.id]);

  /**
   * Cold start: paint the window the previous session ended on while local
   * storage resolves. When present, the open catch-up closes the gap without
   * re-downloading the latest page.
   */
  const [cacheHydrated, setCacheHydrated] = useState(false);

  // ── Offline store: paint local history, reconcile live, re-send queued ──
  // The SQLite window is the durable history; chatCache remains a warm
  // first-paint layer for the previous AsyncStorage generation. Both read the
  // same account-scoped rows, so whichever resolves first paints the same
  // conversation.
  useEffect(() => {
    const ref = offlineRef('community', communityId);
    const key = chatKey(ref);
    let active = true;
    let unsubscribeEvents: (() => void) | null = null;

    const attach = (engine: ReturnType<typeof getOfflineChat>) => {
      unsubscribeEvents?.();
      unsubscribeEvents = null;
      if (!active || !engine) return;

      unsubscribeEvents = engine.subscribe((event) => {
        if (event.type === 'connectivity') return;
        if (event.conversationKey !== key) return;
        if (event.type === 'messages') {
          const local = event.messages.map(fromLocalChatMessage);
          setMessages((prev) => {
            if (communityIdRef.current !== communityId) return prev;
            return reconcileMessages(prev, local, (rows) =>
              rows.sort(compareChatTimeline),
            );
          });
          setCacheHydrated(true);
        } else if (event.type === 'message-failed') {
          setMessages((prev) =>
            prev.map((message) =>
              message.id === `temp-${event.clientNonce}`
                ? { ...message, status: 'failed' }
                : message,
            ),
          );
        }
      });

      if (getCachedCommunityMessageWindow(communityId, user?.id)?.length) return;
      void engine
        .hydrate(ref)
        .then((rows) => {
          if (!active || rows.length === 0 || communityIdRef.current !== communityId) return;
          const local = rows.map(fromLocalChatMessage);
          setMessages((prev) =>
            prev.length
              ? reconcileMessages(prev, local, (rows) => rows.sort(compareChatTimeline))
              : local,
          );
          windowCommunityRef.current = communityId;
          windowUserIdRef.current = user?.id;
          setHasMore(local.length >= PAGE_SIZE);
          setIsLoading(false);
          setCacheHydrated(true);
        })
        .catch(() => undefined);
    };

    const stop = onOfflineChatChange(attach);
    return () => {
      active = false;
      stop();
      unsubscribeEvents?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, user?.id]);

  // Foreground: the socket may have missed edits/de-clarations and reactions;
  // re-read the visible window (one request) and drain the queue. Message
  // catch-up remains the existing `catchUp.schedule()` path.
  useEffect(() => {
    return onOfflineResume(() => {
      const engine = getOfflineChat();
      if (!engine) return;
      const ref = offlineRef('community', communityId);
      void engine.revalidateWindow(ref).catch(() => undefined);
      void engine.drainOutbox().catch(() => undefined);
    });
  }, [communityId]);
  const openCatchUpRef = useRef(false);
  /** When the open catch-up was requested — suppresses the connect echo. */
  const openCatchUpAtRef = useRef(0);
  useEffect(() => {
    openCatchUpRef.current = false;
    openCatchUpAtRef.current = 0;
    setCacheHydrated(false);
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
      // Local-first: the window this screen already persisted holds the history
      // directly above the viewport, so serving it from SQLite turns a ~1 s
      // network page into a read that lands with the scroll. Only when the
      // stored window ends at this cursor does the request go out — and that
      // response, as before, is what decides `hasMore`.
      const localOlder = await readLocalOlder(targetCommunityId, before);
      if (
        communityIdRef.current !== targetCommunityId ||
        userIdRef.current !== targetUserId
      ) return;
      if (localOlder.length > 0) {
        setMessages((prev) => mergeMessagePage(prev, localOlder));
        // Not awaited: these images were fetched when the rows were first read,
        // so the disk/memory cache usually answers instantly and the page must
        // not wait on media to appear.
        void warmChatMedia(localOlder);
        return;
      }
      const older = await getMessages(targetCommunityId, before);
      if (
        communityIdRef.current !== targetCommunityId ||
        userIdRef.current !== targetUserId
      ) return;
      // Measure the prepended page's newest images before it mounts. Those rows
      // sit directly above the viewport, so an image that only gets its shape
      // in `onLoad` would resize the bubble under the reader and push the
      // history they are reading down the list.
      await warmChatMedia(older);
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

  /**
   * Catch up on anything this client is missing: published while the socket
   * was down, or since the loaded snapshot (`load()` schedules one on every
   * open, because an already-live socket fires no status event).
   *
   * Debounced and single-flight: the reconnect signal, the open, and the
   * foreground probe collapse into one serialized drain. The drain follows
   * compound cursors until it reaches the live edge or spends its page budget.
   */
  const catchUpRef = useRef<ReturnType<typeof createCatchUpScheduler> | null>(null);
  const catchUp = useMemo(() => {
    const targetCommunityId = communityId;
    const targetUserId = user?.id;
    return createCatchUpScheduler(async () => {
      const cursor = latestMessageCursor(messagesRef.current);
      const knownServerIds = new Set(messagesRef.current.map((message) => message.id));
      const result = await drainCatchUpPages<Message>({
        from: cursor ?? null,
        pageSize: PAGE_SIZE,
        maxPages: 20,
        fetchPage: (after: MessageCursor) => getMessages(targetCommunityId, undefined, after),
        // An empty chat has no cursor. A single latest-window query is enough
        // to recover its first message after suspension without warming history.
        fetchLatestPage: () => getMessages(targetCommunityId),
        isCancelled: () =>
          communityIdRef.current !== targetCommunityId ||
          userIdRef.current !== targetUserId,
        onPage: (page) => {
          if (
            communityIdRef.current !== targetCommunityId ||
            userIdRef.current !== targetUserId
          ) return 0;
          for (const message of messagesRef.current) knownServerIds.add(message.id);
          let mergedCount = 0;
          for (const message of page) {
            if (knownServerIds.has(message.id)) continue;
            knownServerIds.add(message.id);
            mergedCount += 1;
          }
          setMessages((prev) => {
            if (
              communityIdRef.current !== targetCommunityId ||
              userIdRef.current !== targetUserId
            ) return prev;
            return mergeCaughtUpMessages(prev, page);
          });
          scheduleMarkRead(targetCommunityId, {
            skipIfUpdatedWithinMs: 10_000,
            patch: markRead,
          });
          return mergedCount;
        },
      });
      if (__DEV__ && result.pages > 0) {
        console.debug('[chat] catch-up', {
          pages: result.pages,
          received: result.received,
          merged: result.merged,
          duplicates: result.received - result.merged,
          stoppedBy: result.stoppedBy,
        });
      }
      // Continue a very large but finite backlog in another bounded pass.
      if (result.stoppedBy === 'max-pages') catchUpRef.current?.schedule();
    });
  }, [communityId, user?.id]);
  catchUpRef.current = catchUp;
  useEffect(() => () => catchUp.cancel(), [catchUp]);

  /**
   * One open-time catch-up. A disk window starts it directly; a room without
   * a cache starts it after the initial bootstrap page lands.
   */
  const requestOpenCatchUp = useCallback(() => {
    if (openCatchUpRef.current) return;
    openCatchUpRef.current = true;
    openCatchUpAtRef.current = Date.now();
    catchUp.schedule();
  }, [catchUp]);

  useEffect(() => {
    const userId = user?.id;
    const memoryWindow = userId
      ? getCachedCommunityMessageWindow(communityId, userId)
      : null;
    const promise = userId && !memoryWindow
      ? chatCache.loadCommunityMessages(userId, communityId).catch(() => null)
      : Promise.resolve(null);
    cacheReadRef.current = { communityId, userId, promise };
    if (memoryWindow) {
      setCacheHydrated(true);
      return undefined;
    }
    if (!userId) {
      setCacheHydrated(true);
      return undefined;
    }
    let active = true;
    void promise
      .then((cached) => {
        if (!active || !cached || cached.length === 0) return;
        // Plain id-dedupe: unlike the catch-up merge this must never "confirm"
        // an in-flight optimistic bubble, or an old cached row with the same
        // text would remove the message the member just sent.
        setMessages((prev) => {
          if (
            communityIdRef.current !== communityId ||
            userIdRef.current !== userId
          ) return prev;
          return mergeMessagePage(prev, cached);
        });
        requestOpenCatchUp();
      })
      .finally(() => {
        if (active) setCacheHydrated(true);
      });
    return () => {
      active = false;
    };
  }, [communityId, requestOpenCatchUp, user?.id]);

  const load = useCallback(async () => {
    const targetCommunityId = communityId;
    const targetUserId = user?.id;
    const memoryWindow = targetUserId
      ? getCachedCommunityMessageWindow(targetCommunityId, targetUserId)
      : null;
    setIsLoading(true);
    setError(null);
    try {
      if (memoryWindow?.length) {
        setMessages((prev) => {
          if (
            communityIdRef.current !== targetCommunityId ||
            userIdRef.current !== targetUserId
          ) return prev;
          return mergeMessagePage(prev, memoryWindow);
        });
        setHasMore(memoryWindow.length >= PAGE_SIZE);
        scheduleMarkRead(targetCommunityId, {
          bypassCooldown: true,
          skipIfUpdatedWithinMs: 10_000,
          patch: markRead,
        });
        requestOpenCatchUp();
        return;
      }
      const cacheRead = cacheReadRef.current;
      const diskMessages =
        cacheRead?.communityId === targetCommunityId && cacheRead.userId === targetUserId
          ? await cacheRead.promise
          : null;
      if (
        communityIdRef.current !== targetCommunityId ||
        userIdRef.current !== targetUserId
      ) return;

      // A valid disk window is already a usable first page. The cursor drain
      // asks only for rows missed while this community was away.
      if (diskMessages?.length) {
        if (targetUserId) {
          rememberCommunityMessageWindow(targetCommunityId, diskMessages, targetUserId);
        }
        setHasMore(diskMessages.length >= PAGE_SIZE);
        scheduleMarkRead(targetCommunityId, {
          bypassCooldown: true,
          skipIfUpdatedWithinMs: 10_000,
          patch: markRead,
        });
        requestOpenCatchUp();
        return;
      }

      // No usable message window exists, so bootstrap supplies the initial
      // latest page. Pagination and catch-up use cursor pages only.
      const bootstrap = await fetchCommunityBootstrap(targetCommunityId, targetUserId);
      // The user switched communities while the request was in flight — those
      // rows belong to the community that was on screen, not this one.
      if (
        communityIdRef.current !== targetCommunityId ||
        userIdRef.current !== targetUserId
      ) return;
      // Warm the newest page's images before the list paints: this is what lets
      // an image-only bubble (a GIF or sticker) render its frame on the first
      // pass instead of appearing only once its bytes arrive.
      await warmChatMedia(bootstrap.messages);
      if (
        communityIdRef.current !== targetCommunityId ||
        userIdRef.current !== targetUserId
      ) return;
      // Merge, never replace: realtime rows that landed while the request was
      // in flight — and the window a previous visit folded into the cache
      // (the patch effect below) — are newer than the fetched snapshot and
      // must survive it.
      const sameWindow =
        windowCommunityRef.current === targetCommunityId &&
        windowUserIdRef.current === targetUserId;
      windowCommunityRef.current = targetCommunityId;
      windowUserIdRef.current = targetUserId;
      setMessages((prev) => {
        if (
          communityIdRef.current !== targetCommunityId ||
          userIdRef.current !== targetUserId
        ) return prev;
        return mergeCaughtUpMessages(sameWindow ? prev : [], bootstrap.messages);
      });
      // A full page means older history may exist.
      setHasMore(bootstrap.messages.length >= PAGE_SIZE);
      // Opening the chat is a user action — its mark-read bypasses the
      // realtime cooldown so the badge always clears (see lib/readManager).
      // If the list tap just sent the same PATCH, this one falls away.
      scheduleMarkRead(targetCommunityId, {
        bypassCooldown: true,
        skipIfUpdatedWithinMs: 10_000,
        patch: markRead,
      });
      // Close the gap between the snapshot and now on EVERY open, exactly like
      // the web chat's mount catch-up: this room's socket is often already
      // connected (the communities list keeps the live window's sockets
      // open), so mounting fires no status event and nothing else would ask
      // for what was published since the snapshot.
      requestOpenCatchUp();
    } catch (e) {
      if (
        communityIdRef.current === targetCommunityId &&
        userIdRef.current === targetUserId
      ) setError(e instanceof Error ? e.message : 'Failed to load messages');
    } finally {
      if (
        communityIdRef.current === targetCommunityId &&
        userIdRef.current === targetUserId
      ) setIsLoading(false);
    }
  }, [communityId, requestOpenCatchUp, user?.id]);

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

  /** The newest window waiting to be written to disk (see the effect below). */
  const pendingSaveRef = useRef<{
    userId: string;
    communityId: string;
    rows: Message[];
  } | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const pending = pendingSaveRef.current;
    pendingSaveRef.current = null;
    if (pending) {
      void chatCache.saveCommunityMessages(
        pending.userId,
        pending.communityId,
        pending.rows,
      );
    }
  }, []);
  // A room switch or a sign-out must not drop the last window on the floor.
  useEffect(() => () => flushSave(), [communityId, user?.id, flushSave]);

  /**
   * Keep the bounded in-memory switch window and shared bootstrap current with
   * what is on screen — the mobile counterpart of the web chat's live msgCache.
   * Leaving and re-entering paints the rows the user just saw (their own sends
   * included) instead of waiting for disk or the fetch-time snapshot.
   *
   * Optimistic rows are never persisted — a resurrected "sending" bubble could
   * never resolve — and an empty window is never written because it has no
   * confirmed cursor to resume from on the next open.
   *
   * The disk write is throttled: a busy room changes state on every message,
   * echo and reaction, and serializing the whole window each time is pure
   * JavaScript work the UI can feel. The last state within the window wins.
   */
  useEffect(() => {
    if (!cacheHydrated) return;
    if (windowCommunityRef.current !== communityId) return;
    if (windowUserIdRef.current !== user?.id) return;
    const rows = messages.filter((message) => !message.id.startsWith('temp-'));
    if (rows.length === 0) return;
    const userId = user?.id;
    if (userId) patchCachedBootstrapMessages(communityId, rows, userId);
    // Write-through to the persistent window: a process restart reads this
    // back on mount, so everything the member just saw survives the kill.
    if (!userId) return;
    pendingSaveRef.current = { userId, communityId, rows };
    if (saveTimerRef.current) return;
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      const pending = pendingSaveRef.current;
      pendingSaveRef.current = null;
      if (pending) {
        void chatCache.saveCommunityMessages(
          pending.userId,
          pending.communityId,
          pending.rows,
        );
        // Durable copy for the offline reader and cross-restart sync state.
        // The controller keeps only confirmed rows here; queued rows are owned
        // by the outbox record written in the same transaction.
        const engine = getOfflineChat();
        if (engine) {
          const ref = offlineRef('community', pending.communityId);
          void engine
            .persistWindow(
              ref,
              pending.rows.map((row) =>
                toLocalChatMessage(pending.userId, ref, row),
              ),
            )
            .catch(() => undefined);
        }
      }
    }, 500);
  }, [cacheHydrated, communityId, messages, user?.id]);

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
        // A live socket is proof the API is reachable: retry the queue. The
        // window revalidation catches edits/deletes/reactions lost while the
        // socket was down (an ?after= cursor cannot see those).
        const engine = getOfflineChat();
        if (engine) {
          const offlineRefForRoom = offlineRef('community', communityId);
          void engine.revalidateWindow(offlineRefForRoom).catch(() => undefined);
          void engine.drainOutbox().catch(() => undefined);
        }
        // Mounting a chat opens its socket; that first "connected" is not a
        // gap — the open catch-up is already covering it.
        if (Date.now() - openCatchUpAtRef.current < 5_000) return;
        catchUp.schedule();
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
