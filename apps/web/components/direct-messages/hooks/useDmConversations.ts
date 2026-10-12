"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJsonCached } from "@/lib/request-cache";
import { applyReadFloor, dmCache } from "@/lib/direct-messages/client-cache";
import { getReadFloor } from "@/lib/direct-messages/read-manager";
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
        // A payload fetched before this client's read PATCH landed carries the
        // pre-read unread counts; the read floor keeps those from resurrecting
        // the badge the user just cleared.
        const next = (data.conversations ?? []).map((conversation) =>
          applyReadFloor(conversation, getReadFloor(conversation.id)),
        );
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
