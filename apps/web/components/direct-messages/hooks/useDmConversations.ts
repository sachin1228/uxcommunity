"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchJsonCached } from "@/lib/request-cache";
import { applyLocalReaction, applyReadFloor, dmCache } from "@/lib/direct-messages/client-cache";
import { getReadFloor } from "@/lib/direct-messages/read-manager";
import { dmUrls } from "@/lib/direct-messages/client";
import type { DmConversationSummary } from "@/lib/direct-messages/types";
import { chatKey } from "@uxcommunity/offline-chat";
import {
  getOfflineChat,
  offlineRef,
  onOfflineChatChange,
} from "@/lib/offline/engine";

/**
 * One list read, reconciled with what this client already knows — the read
 * floor and the locally painted reaction preview are merged over the payload.
 *
 * React-free on purpose: the caller decides when to paint, which keeps the
 * state write out of the synchronous body of the effect that primes the list.
 */
async function loadConversations(
  userId: string,
  force: boolean,
): Promise<DmConversationSummary[]> {
  const data = await fetchJsonCached<{ conversations?: DmConversationSummary[] }>(
    dmUrls.conversations,
    { staleMs: 30_000, force },
    userId,
  );
  // A payload fetched before this client's read PATCH landed carries the
  // pre-read unread counts; the read floor keeps those from resurrecting the
  // badge the user just cleared. The locally painted reaction preview is merged
  // over the payload the same way, because the server's reaction publish and
  // this projection are not in step — a refetch in between used to wipe the
  // line the member just watched appear.
  const previousById = new Map(
    (dmCache.getConversations() ?? []).map((c) => [c.id, c] as const),
  );
  return (data.conversations ?? []).map((conversation) => {
    const withFloor = applyReadFloor(conversation, getReadFloor(conversation.id));
    return applyLocalReaction(withFloor, previousById.get(conversation.id)?.last_reaction);
  });
}

/**
 * The DM conversation list. Seeds from the module cache for an instant
 * remount, then refreshes through the shared request cache (30 s stale).
 */
export function useDmConversations({ userId }: { userId: string }) {
  const [conversations, setConversationsState] = useState<DmConversationSummary[] | null>(
    () => dmCache.getConversations(),
  );

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

  // ── Offline: paint the last persisted list, then keep it current ─────────
  useEffect(() => {
    let active = true;
    const attach = (engine: ReturnType<typeof getOfflineChat>) => {
      if (!active || !engine || dmCache.getConversations()) return;
      void engine
        .listConversations()
        .then((rows) => {
          if (!active || dmCache.getConversations()) return;
          const cached = rows
            .filter((row) => row.ref.kind === "dm")
            .map((row) => row.payload as unknown as DmConversationSummary)
            .filter((row) => typeof row?.id === "string" && !!row.peer);
          if (cached.length === 0) return;
          dmCache.setConversations(cached);
          setConversationsState(cached);
        })
        .catch(() => undefined);
    };
    const stop = onOfflineChatChange(attach);
    return () => {
      active = false;
      stop();
    };
  }, [userId]);

  // Bounded list write; the controller scopes it to the signed-in member.
  useEffect(() => {
    if (!conversations || conversations.length === 0) return undefined;
    const timer = setTimeout(() => {
      const engine = getOfflineChat();
      if (!engine) return;
      void engine
        .saveConversations(
          conversations.map((conversation) => {
            const ref = offlineRef("dm", conversation.id);
            return {
              userId,
              conversationKey: chatKey(ref),
              ref,
              lastMessageAt: conversation.last_message_at,
              unreadCount: conversation.unread_count,
              payload: conversation as unknown as Record<string, unknown>,
              updatedAt: Date.now(),
            };
          }),
        )
        .catch(() => undefined);
    }, 500);
    return () => clearTimeout(timer);
  }, [conversations, userId]);

  const refresh = useCallback(
    async (force = false) => {
      try {
        const next = await loadConversations(userId, force);
        dmCache.setConversations(next);
        setConversationsState(next);
      } catch {
        // Keep whatever is on screen; the next catch-up retries.
      }
    },
    [userId],
  );

  // Prime on mount and whenever the signed-in member changes. The list is
  // painted from the fetch's continuation rather than synchronously in the
  // effect body, so priming never cascades a second render. A response that
  // arrives after the effect was torn down still lands in the module cache —
  // it is the paint, not the snapshot, that has to be dropped.
  useEffect(() => {
    let cancelled = false;
    void loadConversations(userId, false)
      .then((next) => {
        dmCache.setConversations(next);
        if (!cancelled) setConversationsState(next);
      })
      .catch(() => {
        // Keep whatever is on screen; the next catch-up retries.
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { conversations, setConversations, refresh };
}
