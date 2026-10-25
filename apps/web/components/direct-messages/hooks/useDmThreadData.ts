"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJsonCached } from "@/lib/request-cache";
import { dmCache } from "@/lib/direct-messages/client-cache";
import { dmUrls } from "@/lib/direct-messages/client";
import { dmCursorQuery } from "@/lib/direct-messages/cursor";
import {
  compareDmMessages,
  cursorAfter,
  mergeDmMessages,
  newestRealMessage,
  type MessageCursor,
} from "@/lib/direct-messages/messages";
import { DM_MESSAGE_PAGE_SIZE } from "@/lib/direct-messages/constants";
import type { DmMessage } from "@/lib/direct-messages/types";
import { chatKey } from "@uxcommunity/offline-chat";
import {
  OFFLINE_RESUME_EVENT,
  getOfflineChat,
  offlineRef,
  onOfflineChatChange,
} from "@/lib/offline/engine";
import { fromLocalDmMessage, toLocalDmMessage } from "@/lib/offline/rows";

/**
 * Merge the local store's copy over what is on screen: confirmed rows replace
 * their optimistic bubbles by nonce, edits/deletes replace by id, and rows the
 * store does not hold (older paginated history) stay put.
 */
function reconcileWithLocalWindow(
  current: DmMessage[],
  local: DmMessage[],
): DmMessage[] {
  if (local.length === 0) return current;
  const localById = new Map(local.map((row) => [row.id, row]));
  const localNonces = new Set(
    local.map((row) => row.client_nonce).filter((nonce): nonce is string => !!nonce),
  );
  const seen = new Set<string>();
  const next: DmMessage[] = [];

  for (const row of current) {
    if (
      row.id.startsWith("temp-") &&
      row.client_nonce &&
      localNonces.has(row.client_nonce) &&
      !localById.has(row.id)
    ) {
      continue;
    }
    next.push(localById.get(row.id) ?? row);
    seen.add(row.id);
  }
  for (const row of local) {
    if (!seen.has(row.id)) next.push(row);
  }
  return next.sort(compareDmMessages);
}

/** A catch-up may legitimately span many pages; this bounds one drain pass. */
const MAX_CATCH_UP_PAGES = 20;

/**
 * The open conversation's messages: cache-first paint, then a page fetch or a
 * full incremental `?after=` catch-up, plus upward pagination.
 *
 * Cursors are compound (created_at, id) — the same total order the SQL pages
 * on — so a burst of same-millisecond messages can neither be split across a
 * page boundary nor skipped. The catch-up LOOPS until a short page arrives:
 * a reconnect after more than one page of messages applies all of them, not
 * the newest 50.
 *
 * Merges run through mergeDmMessages: fetched rows dedupe by id against what
 * is on screen, optimistic (temp-) rows are always preserved, and every
 * writer shares one comparator.
 */
export function useDmThreadData({
  conversationId,
  userId,
}: {
  conversationId: string | null;
  userId: string;
}) {
  const [messages, setMessagesState] = useState<DmMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialReady, setInitialReady] = useState(false);
  const [hasMoreAbove, setHasMoreAbove] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const activeIdRef = useRef<string | null>(conversationId);
  const isFetchingOlderRef = useRef(false);

  const setMessages = useCallback(
    (next: DmMessage[] | ((current: DmMessage[]) => DmMessage[])) => {
      setMessagesState((current) => {
        const resolved = typeof next === "function" ? next(current) : next;
        const target = activeIdRef.current;
        if (target) {
          dmCache.setMessages(target, resolved.filter((m) => !m.id.startsWith("temp-")));
        }
        return resolved;
      });
    },
    [],
  );

  /** One GET page. `cursors` carries at most one side: after (catch-up) or before (history). */
  const fetchPage = useCallback(
    async (
      targetId: string,
      cursors: { before?: MessageCursor | null; after?: MessageCursor | null },
      force: boolean,
    ): Promise<DmMessage[]> => {
      const url = `${dmUrls.conversationMessages(targetId)}${dmCursorQuery(cursors)}`;
      const data = await fetchJsonCached<{ messages?: DmMessage[] }>(
        url,
        // Incremental reads must never replay a cached "nothing new" answer;
        // page loads and history may reuse a recent identical response.
        { staleMs: cursors.after ? 0 : 30_000, force: cursors.after ? true : force },
        userId,
      );
      return data.messages ?? [];
    },
    [userId],
  );

  /**
   * Drain everything newer than `from` (or the newest page when null), page
   * by page, stopping at the first short page. Applies each page as it
   * arrives so a long drain still paints progressively.
   */
  const catchUp = useCallback(
    async (targetId: string, from: MessageCursor | null): Promise<void> => {
      let cursor = from;
      for (let page = 0; page < MAX_CATCH_UP_PAGES; page += 1) {
        const incoming = await fetchPage(targetId, { after: cursor }, true);
        if (activeIdRef.current !== targetId) return;
        if (incoming.length > 0) {
          const last = incoming[incoming.length - 1];
          setMessagesState((current) => {
            if (activeIdRef.current !== targetId) return current;
            const merged = mergeDmMessages(current, incoming);
            if (merged !== current) {
              dmCache.setMessages(targetId, merged.filter((m) => !m.id.startsWith("temp-")));
            }
            return merged;
          });
          cursor = cursorAfter(last);
        }
        if (incoming.length < DM_MESSAGE_PAGE_SIZE) return;
      }
    },
    [fetchPage],
  );

  // ── Switch conversation: paint from cache, then hydrate ────────────────
  useEffect(() => {
    activeIdRef.current = conversationId;
    isFetchingOlderRef.current = false;
    setInitialReady(false);
    setHasMoreAbove(true);
    setLoadingOlder(false);

    if (!conversationId) {
      setMessagesState([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const cached = dmCache.getMessages(conversationId);
    if (cached && cached.length > 0) {
      setMessagesState(cached);
      setHasMoreAbove(cached.length >= DM_MESSAGE_PAGE_SIZE);
      setLoading(false);
      // Paint instantly, but still catch up — events may have landed while
      // this conversation was not on screen, possibly more than one page.
      const newest = newestRealMessage(cached);
      void (async () => {
        try {
          await catchUp(conversationId, newest ? cursorAfter(newest) : null);
        } catch {
          // Leave the painted cache; realtime/focus catch-up retries.
        } finally {
          if (!cancelled && activeIdRef.current === conversationId) {
            setLoading(false);
            setInitialReady(true);
          }
        }
      })();
    } else {
      setMessagesState([]);
      setLoading(true);
      void (async () => {
        try {
          const page = await fetchPage(conversationId, {}, true);
          if (cancelled || activeIdRef.current !== conversationId) return;
          dmCache.setMessages(conversationId, page);
          setMessagesState(page);
          setHasMoreAbove(page.length >= DM_MESSAGE_PAGE_SIZE);
        } catch {
          // Leave what is on screen; the load-error path is the empty thread.
        } finally {
          if (!cancelled && activeIdRef.current === conversationId) {
            setLoading(false);
            setInitialReady(true);
          }
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [conversationId, userId, catchUp, fetchPage]);

  /** Incremental catch-up for the OPEN conversation (used by realtime). */
  const fetchMessages = useCallback(
    async (after?: MessageCursor): Promise<void> => {
      const targetId = activeIdRef.current;
      if (!targetId) return;
      try {
        await catchUp(targetId, after ?? null);
      } catch {
        // best-effort — the next event or focus pass retries
      }
    },
    [catchUp],
  );

  /** Older page (IntersectionObserver sentinel). */
  const fetchOlderMessages = useCallback(
    async (before: MessageCursor): Promise<void> => {
      const targetId = activeIdRef.current;
      if (!targetId || isFetchingOlderRef.current) return;
      isFetchingOlderRef.current = true;
      setLoadingOlder(true);
      try {
        const incoming = await fetchPage(targetId, { before }, false);
        if (activeIdRef.current !== targetId) return;
        if (incoming.length < DM_MESSAGE_PAGE_SIZE) setHasMoreAbove(false);
        if (incoming.length === 0) return;
        setMessagesState((current) => {
          if (activeIdRef.current !== targetId) return current;
          const merged = mergeDmMessages(current, incoming);
          if (merged !== current) {
            dmCache.setMessages(targetId, merged.filter((m) => !m.id.startsWith("temp-")));
          }
          return merged;
        });
      } catch {
        // leave state as-is
      } finally {
        isFetchingOlderRef.current = false;
        setLoadingOlder(false);
      }
    },
    [fetchPage],
  );

  // ── Offline layer: local-first paint, live reconciliation, durable writes ──
  useEffect(() => {
    if (typeof window === "undefined" || !conversationId) return undefined;
    const ref = offlineRef("dm", conversationId);
    const key = chatKey(ref);
    let active = true;
    let unsubscribeEvents: (() => void) | null = null;

    const attach = (engine: ReturnType<typeof getOfflineChat>) => {
      unsubscribeEvents?.();
      unsubscribeEvents = null;
      if (!active || !engine) return;

      unsubscribeEvents = engine.subscribe((event) => {
        if (event.type !== "messages" || event.conversationKey !== key) return;
        const local = event.messages.map(fromLocalDmMessage);
        setMessages((current) => {
          if (activeIdRef.current !== conversationId) return current;
          const next = reconcileWithLocalWindow(current, local);
          dmCache.setMessages(
            conversationId,
            next.filter((row) => !row.id.startsWith("temp-")),
          );
          return next;
        });
      });

      if (dmCache.getMessages(conversationId)?.length) return;
      void engine
        .hydrate(ref)
        .then((rows) => {
          if (!active || rows.length === 0 || activeIdRef.current !== conversationId) return;
          const local = rows.map(fromLocalDmMessage);
          setMessages((current) =>
            current.length ? reconcileWithLocalWindow(current, local) : local,
          );
          setHasMoreAbove(local.length >= DM_MESSAGE_PAGE_SIZE);
          setLoading(false);
          setInitialReady(true);
        })
        .catch(() => undefined);
    };

    const unsubscribeChange = onOfflineChatChange(attach);
    return () => {
      active = false;
      unsubscribeChange();
      unsubscribeEvents?.();
    };
  }, [conversationId, userId, setMessages]);

  useEffect(() => {
    if (!conversationId || messages.length === 0) return undefined;
    const timer = setTimeout(() => {
      const engine = getOfflineChat();
      if (!engine) return;
      const ref = offlineRef("dm", conversationId);
      const rows = messages.map((row) => toLocalDmMessage(userId, ref, row));
      void engine.persistWindow(ref, rows).catch(() => undefined);
    }, 400);
    return () => clearTimeout(timer);
  }, [messages, conversationId, userId]);

  // Reconnect: re-read the visible window for edits/deletes/reactions missed
  // while offline, then drain the outbox. Missed-message catch-up stays with
  // the existing realtime/focus path.
  useEffect(() => {
    const onResume = () => {
      const engine = getOfflineChat();
      if (!engine || !conversationId) return;
      const ref = offlineRef("dm", conversationId);
      void engine.revalidateWindow(ref).catch(() => undefined);
      void engine.drainOutbox().catch(() => undefined);
    };
    window.addEventListener(OFFLINE_RESUME_EVENT, onResume);
    return () => window.removeEventListener(OFFLINE_RESUME_EVENT, onResume);
  }, [conversationId]);

  return {
    messages,
    setMessages,
    loading,
    initialReady,
    hasMoreAbove,
    loadingOlder,
    fetchMessages,
    fetchOlderMessages,
  };
}
