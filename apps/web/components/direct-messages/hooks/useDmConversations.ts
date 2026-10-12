"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJsonCached } from "@/lib/request-cache";
import { dmCache } from "@/lib/direct-messages/client-cache";
import { dmUrls } from "@/lib/direct-messages/client";
import type { DmConversationSummary } from "@/lib/direct-messages/types";

/**
 * The DM conversation list. Seeds from the module cache for an instant
 * remount, then refreshes through the shared request cache (30 s stale).
 */
export function useDmConversations({ userId }: { userId: string }) {
  const [conversations, setConversationsState] = useState<DmConversationSummary[] | null>(
    () => dmCache.getConversations(),
  );
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const setConversations = useCallback(
    (next: DmConversationSummary[] | ((current: DmConversationSummary[]) => DmConversationSummary[])) => {
      setConversationsState((current) => {
        const resolved =
          typeof next === "function" ? next(current ?? []) : next;
        dmCache.setConversations(resolved);
        return resolved;
      });
    },
    [],
  );

  const refresh = useCallback(
    async (force = false) => {
      try {
        const data = await fetchJsonCached<{ conversations?: DmConversationSummary[] }>(
          dmUrls.conversations,
          { staleMs: 30_000, force },
          userId,
        );
        const next = data.conversations ?? [];
        dmCache.setConversations(next);
        setConversationsState(next);
      } catch {
        // Keep whatever is on screen; the next catch-up retries.
      }
    },
    [userId],
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { conversations, setConversations, refresh };
}
