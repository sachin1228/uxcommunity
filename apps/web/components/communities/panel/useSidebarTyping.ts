"use client";

import { useEffect, useRef, useState } from "react";
import { useDocumentVisible } from "@/lib/use-document-visible";
import { realtimeClient } from "@/lib/realtime/client";
import { realtimeRooms } from "@/lib/realtime/rooms";
import type { CachedSidebarCommunity } from "@/lib/communities/cache";

const TYPING_EXPIRY_MS = 3500;
const TYPING_CHANNEL_LIMIT = 8;

export function useSidebarTyping({
  communities,
  userId,
}: {
  communities: CachedSidebarCommunity[];
  userId: string;
}): Map<string, string> {
  const [typingMap, setTypingMap] = useState<Map<string, string>>(new Map());
  const stateRef = useRef<Map<string, Map<string, { name: string; lastSeen: number }>>>(new Map());
  const communityIds = [...communities].map((c) => c.id).sort().join(",");
  const isVisible = useDocumentVisible();

  useEffect(() => {
    if (!communityIds || !isVisible) return;
    stateRef.current.clear();

    realtimeClient.init({ id: userId, name: null, avatar: null });
    const subscribed = communities.slice(0, TYPING_CHANNEL_LIMIT);
    const unsubscribes: Array<() => void> = [];

    const flush = () => {
      const now = Date.now();
      stateRef.current.forEach((userMap) => {
        for (const [uid, entry] of userMap.entries()) {
          if (now - entry.lastSeen > TYPING_EXPIRY_MS) userMap.delete(uid);
        }
      });
      const next = new Map<string, string>();
      stateRef.current.forEach((userMap, commId) => {
        const names = [...userMap.values()].map((e) => e.name);
        if (!names.length) return;
        const text = names.length === 1 ? `${names[0]} is typing…` : names.length === 2 ? `${names[0]} & ${names[1]} are typing…` : "Several people are typing…";
        next.set(commId, text);
      });
      setTypingMap(next);
    };

    for (const comm of subscribed) {
      const chatRoom = realtimeRooms.chat(comm.id);
      realtimeClient.subscribe(chatRoom);
      realtimeClient.connect();

      unsubscribes.push(
        realtimeClient.on(chatRoom, "typing", (data) => {
          const payload = (data ?? {}) as Record<string, unknown>;
          const senderId = typeof payload?.user_id === "string" ? payload.user_id : "";
          const name = typeof payload?.name === "string" ? payload.name : "Someone";
          const typing = payload?.typing === true;
          const ts = typeof payload?.ts === "number" ? payload.ts : Date.now();
          if (!senderId || senderId === userId) return;
          let userMap = stateRef.current.get(comm.id);
          if (!userMap) { userMap = new Map(); stateRef.current.set(comm.id, userMap); }
          if (typing) { userMap.set(senderId, { name, lastSeen: ts }); }
          else { userMap.delete(senderId); if (userMap.size === 0) stateRef.current.delete(comm.id); }
          flush();
        }),
      );
      unsubscribes.push(() => realtimeClient.unsubscribe(chatRoom));
    }

    const timer = window.setInterval(flush, 1000);
    return () => {
      window.clearInterval(timer);
      stateRef.current.clear();
      unsubscribes.forEach((unsub) => unsub());
      setTypingMap(new Map());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityIds, userId, isVisible]);

  return typingMap;
}
