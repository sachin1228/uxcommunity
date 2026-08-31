"use client";

import { useEffect, useRef, useState } from "react";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { realtimePool } from "@/lib/realtime/pool";
import type { CachedSidebarCommunity } from "@/lib/communities/cache";

const TYPING_EXPIRY_MS = 3500;

/**
 * Subscribes to typing events across joined communities via the chat room
 * connections (same connections used for message delivery).
 *
 * Since typing events are now published to the chat room, no separate typing
 * room connections are needed. This hook acquires pool connections and listens
 * for "typing" events on the chat rooms.
 *
 * Returns a Map<communityId, displayText> so the sidebar can show
 * "John is typing…" in place of the last-message preview.
 *
 * Read-only — this hook never broadcasts (the active chat's useTypingPresence
 * handles broadcasting for the current user).
 */
const TYPING_CHANNEL_LIMIT = 8;

export function useSidebarTyping({
  communities,
  userId,
}: {
  communities: CachedSidebarCommunity[];
  userId: string;
}): Map<string, string> {
  const [typingMap, setTypingMap] = useState<Map<string, string>>(new Map());

  // communityId → ( senderId → { name, lastSeen } )
  const stateRef = useRef<Map<string, Map<string, { name: string; lastSeen: number }>>>(
    new Map(),
  );

  const communityIds = [...communities].map((c) => c.id).sort().join(",");
  const isVisible = useDocumentVisible();

  useEffect(() => {
    if (!communityIds || !isVisible) return;

    stateRef.current.clear();

    const subscribed = communities.slice(0, TYPING_CHANNEL_LIMIT);

    /** Expire stale entries and push the updated map into React state. */
    const flush = () => {
      const now = Date.now();
      stateRef.current.forEach((userMap, commId) => {
        for (const [uid, entry] of userMap.entries()) {
          if (now - entry.lastSeen > TYPING_EXPIRY_MS) userMap.delete(uid);
        }
        if (userMap.size === 0) stateRef.current.delete(commId);
      });

      const next = new Map<string, string>();
      stateRef.current.forEach((userMap, commId) => {
        const names = [...userMap.values()].map((e) => e.name);
        if (!names.length) return;
        const text =
          names.length === 1
            ? `${names[0]} is typing…`
            : names.length === 2
            ? `${names[0]} & ${names[1]} are typing…`
            : "Several people are typing…";
        next.set(commId, text);
      });
      setTypingMap(next);
    };

    const releases: Array<() => void> = [];
    for (const comm of subscribed) {
      // Acquire a pool connection to the chat room (reuses existing if open).
      const client = realtimePool.acquire(comm.id, { id: userId, name: null, avatar: null });
      client.on(
        "typing",
        (data) => {
          const payload = (data ?? {}) as Record<string, unknown>;
          const senderId =
            typeof payload?.user_id === "string" ? payload.user_id : "";
          const name =
            typeof payload?.name === "string" ? payload.name : "Someone";
          const typing  = payload?.typing === true;
          const ts      =
            typeof payload?.ts === "number" ? payload.ts : Date.now();

          // Ignore our own broadcasts and malformed payloads.
          if (!senderId || senderId === userId) return;

          let userMap = stateRef.current.get(comm.id);
          if (!userMap) {
            userMap = new Map();
            stateRef.current.set(comm.id, userMap);
          }

          if (typing) {
            userMap.set(senderId, { name, lastSeen: ts });
          } else {
            userMap.delete(senderId);
            if (userMap.size === 0) stateRef.current.delete(comm.id);
          }

          flush();
        },
      );
      releases.push(() => realtimePool.release(comm.id));
    }

    // Sweep every second to expire anyone who closed their tab silently.
    const timer = window.setInterval(flush, 1000);

    return () => {
      window.clearInterval(timer);
      stateRef.current.clear();
      releases.forEach((release) => release());
      setTypingMap(new Map());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityIds, userId, isVisible]);

  return typingMap;
}
