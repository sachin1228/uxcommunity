"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchJsonCached } from "@/lib/request-cache";
import { applyLocalReaction, applyReadFloor, dmCache } from "@/lib/direct-messages/client-cache";
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
        // the badge the user just cleared. The locally painted reaction preview
        // is merged over the payload the same way, because the server's
        // reaction publish and this projection are not in step — a refetch in
        // between used to wipe the line the member just watched appear.
        const previousById = new Map(
          (dmCache.getConversations() ?? []).map((c) => [c.id, c] as const),
        );
        const next = (data.conversations ?? []).map((conversation) => {
          const withFloor = applyReadFloor(conversation, getReadFloor(conversation.id));
          return applyLocalReaction(withFloor, previousById.get(conversation.id)?.last_reaction);
        });
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
