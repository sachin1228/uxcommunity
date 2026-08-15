"use client";

import { useEffect, useRef, useState } from "react";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { RealtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import type { CachedSidebarCommunity } from "@/lib/communities/cache";

const TYPING_EXPIRY_MS = 3500;

/**
 * Subscribes to the same `typing:<id>` rooms used by CommunityChat's
 * useTypingPresence, but across joined communities at once.
 *
 * Returns a Map<communityId, displayText> so the sidebar can show
 * "John is typing…" in place of the last-message preview for any community
 * where someone is actively typing — including the currently open one, so
 * the indicator stays visible consistently (the chat window shows it above
 * the input, the sidebar shows it in the row).
 *
 * Read-only — this hook never broadcasts (the active chat's useTypingPresence
 * handles broadcasting for the current user). One WebSocket per community, so
 * this subscribes to at most TYPING_CHANNEL_LIMIT communities.
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

    const clients: RealtimeClient[] = [];
    for (const comm of subscribed) {
      const client = new RealtimeClient({
        room: realtimeRooms.typing(comm.id),
        user: { id: userId, name: null, avatar: null },
      });
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
      client.connect();
      clients.push(client);
    }

    // Sweep every second to expire anyone who closed their tab silently.
    const timer = window.setInterval(flush, 1000);

    return () => {
      window.clearInterval(timer);
      stateRef.current.clear();
      clients.forEach((client) => client.close());
      setTypingMap(new Map());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityIds, userId, isVisible]);

  return typingMap;
}