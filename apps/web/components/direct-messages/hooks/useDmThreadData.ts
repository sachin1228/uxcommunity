"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJsonCached } from "@/lib/request-cache";
import { dmCache } from "@/lib/direct-messages/client-cache";
import { dmUrls } from "@/lib/direct-messages/client";
import { toUtcCursor } from "@/lib/direct-messages/cursor";
import { DM_MESSAGE_PAGE_SIZE } from "@/lib/direct-messages/constants";
import type { DmMessage } from "@/lib/direct-messages/types";

/**
 * The open conversation's messages: cache-first paint, then a page fetch or
 * an incremental `?after=` catch-up, plus upward pagination. The window /
 * merge rules mirror the community chat's useChatData (temp rows never enter
 * the module cache; appended rows merge by id and stay sorted).
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
    if (cached) {
      setMessagesState(cached);
      setHasMoreAbove(cached.length >= DM_MESSAGE_PAGE_SIZE);
      // Paint instantly, but still catch up — events may have landed while
      // this conversation was not on screen.
      setLoading(false);
      const lastReal = cached.filter((m) => !m.id.startsWith("temp-")).at(-1);
      void fetchPage(conversationId, lastReal?.created_at, true);
    } else {
      setMessagesState([]);
      setLoading(true);
      void fetchPage(conversationId, undefined, true);
    }

    async function fetchPage(targetId: string, after?: string, force = false): Promise<void> {
      try {
        const url = after
          ? `${dmUrls.conversationMessages(targetId)}?after=${encodeURIComponent(toUtcCursor(after))}`
          : dmUrls.conversationMessages(targetId);
        const data = await fetchJsonCached<{ messages?: DmMessage[] }>(
          url,
          // Incremental reads must never replay a cached "nothing new" answer.
          { staleMs: after ? 0 : 60_000, force: after ? true : force },
          userId,
        );
        if (cancelled || activeIdRef.current !== targetId) return;
        const incoming = data.messages ?? [];
        if (after) {
          setMessagesState((current) => {
            if (activeIdRef.current !== targetId) return current;
            const currentIds = new Set(current.map((m) => m.id));
            const toAdd = incoming.filter((m) => !currentIds.has(m.id));
            if (toAdd.length === 0) return current;
            const merged = [
              ...current.filter((m) => !m.id.startsWith("temp-")),
              ...toAdd,
            ].sort(
              (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
            );
            dmCache.setMessages(targetId, merged);
            return merged;
          });
        } else {
          dmCache.setMessages(targetId, incoming);
          setMessagesState(incoming);
          setHasMoreAbove(incoming.length >= DM_MESSAGE_PAGE_SIZE);
        }
      } catch {
        // Leave what is on screen; the load-error path is the empty thread.
      } finally {
        if (!cancelled && activeIdRef.current === targetId) {
          setLoading(false);
          setInitialReady(true);
        }
      }
    }

    return () => {
      cancelled = true;
    };
    // setMessages is stable; fetchPage closes over the refs above.
  }, [conversationId, userId]);

  /** Incremental catch-up for the OPEN conversation (used by realtime). */
  const fetchMessages = useCallback(
    async (after?: string, force = true): Promise<void> => {
      const targetId = activeIdRef.current;
      if (!targetId) return;
      try {
        const url = after
          ? `${dmUrls.conversationMessages(targetId)}?after=${encodeURIComponent(toUtcCursor(after))}`
          : dmUrls.conversationMessages(targetId);
        const data = await fetchJsonCached<{ messages?: DmMessage[] }>(
          url,
          { staleMs: after ? 0 : 60_000, force: after ? true : force },
          userId,
        );
        if (activeIdRef.current !== targetId) return;
        const incoming = data.messages ?? [];
        setMessagesState((current) => {
          if (activeIdRef.current !== targetId) return current;
          const currentIds = new Set(current.map((m) => m.id));
          const toAdd = incoming.filter((m) => !currentIds.has(m.id));
          if (toAdd.length === 0) return current;
          const merged = [
            ...current.filter((m) => !m.id.startsWith("temp-")),
            ...toAdd,
          ].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
          );
          dmCache.setMessages(targetId, merged);
          return merged;
        });
      } catch {
        // best-effort
      }
    },
    [userId],
  );

  /** Older page (IntersectionObserver sentinel). */
  const fetchOlderMessages = useCallback(
    async (before: string): Promise<void> => {
      const targetId = activeIdRef.current;
      if (!targetId || isFetchingOlderRef.current) return;
      isFetchingOlderRef.current = true;
      setLoadingOlder(true);
      try {
        const url = `${dmUrls.conversationMessages(targetId)}?before=${encodeURIComponent(toUtcCursor(before))}`;
        const data = await fetchJsonCached<{ messages?: DmMessage[] }>(
          url,
          { staleMs: 30_000 },
          userId,
        );
        if (activeIdRef.current !== targetId) return;
        const incoming = data.messages ?? [];
        if (incoming.length < DM_MESSAGE_PAGE_SIZE) setHasMoreAbove(false);
        if (incoming.length === 0) return;
        setMessagesState((current) => {
          if (activeIdRef.current !== targetId) return current;
          const currentIds = new Set(current.map((m) => m.id));
          const toAdd = incoming.filter((m) => !currentIds.has(m.id));
          if (toAdd.length === 0) return current;
          const merged = [
            ...toAdd,
            ...current.filter((m) => !m.id.startsWith("temp-")),
          ].sort(
            (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
          );
          dmCache.setMessages(targetId, merged);
          return merged;
        });
      } catch {
        // leave state as-is
      } finally {
        isFetchingOlderRef.current = false;
        setLoadingOlder(false);
      }
    },
    [userId],
  );

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
